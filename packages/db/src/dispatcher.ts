import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

/**
 * event متاخد من الـ outbox عشان يتوصل — الـ id هو مفتاح الـ dedupe عند كل consumer.
 */
export interface ClaimedEvent {
  readonly companyId: string;
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: unknown;
  /** رقم المحاولة دي، من 1 — بيتحسب وقت الـ claim، فحتى المحاولة اللي وقعت في النص بتتعد. */
  readonly attempt: number;
}

/**
 * نتيجة توصيل event واحد: اتوصل، أو فشل ومعاه إمتى المحاولة الجاية (null = يقف parked).
 */
export type DeliveryOutcome =
  | { readonly delivered: true }
  | { readonly delivered: false; readonly error: string; readonly retryInMs: number | null };

/**
 * الـ facade المحدود بتاع الـ dispatcher (ADR-0003 §3): ياخد batch ويوصّله ويسجّل النتيجة، ينضّف مفاتيح
 * الـ idempotency القديمة، يتأكد إن الاتصال شغال، ويقفل الـ pool — ومفيش أي طريقة تانية يوصل بيها لأي جدول.
 */
export interface OutboxDispatcherDatabase {
  dispatchBatch(
    limit: number,
    deliver: (event: ClaimedEvent) => Promise<DeliveryOutcome>,
    options?: DispatchOptions,
  ): Promise<number>;
  sweepExpiredIdempotencyKeys(batchSize: number): Promise<number>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * إعدادات الـ batch: مدة الحجز، وأقصى عدد محاولات، ومين يتبلّغ لما event يقف لأن محاولاته خلصت وهو محجوز.
 */
export interface DispatchOptions {
  /** مدة حجز الـ event للتوصيل؛ الافتراضي 5 دقايق. */
  readonly leaseMs?: number;
  /** بعد العدد ده من المحاولات، event حجزه خلص من غير نتيجة (crash) بيقف parked بدل ما يتاخد تاني. */
  readonly maxAttempts?: number;
  /** بيتنادى بالـ events اللي وقفت كده، عشان الـ worker يسجّل error log. */
  readonly onExhausted?: (events: readonly ClaimedEvent[]) => void;
}

interface Row extends Record<string, unknown> {
  company_id: string;
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
}

const MAX_BATCH = 100;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 10;
const RETURNING = sql`o.company_id, o.id, o.aggregate_type, o.aggregate_id, o.event_type, o.payload, o.attempts`;

// event محاولاته خلصت وحجزه انتهى من غير نتيجة: الـ worker وقع في كل مرة قبل ما يسجّل، فمحدش هيعمل له park.
// بيقف هنا في نفس transaction الـ claim، وبيفضل ماسك الـ aggregate زي أي event parked.
const exhaustQuery = (maxAttempts: number) => sql`
  UPDATE outbox o SET parked_at = clock_timestamp(), last_error = 'LeaseExpired'
  WHERE o.published_at IS NULL AND o.parked_at IS NULL AND o.next_attempt_at <= clock_timestamp()
    AND o.attempts >= ${maxAttempts}
  RETURNING ${RETURNING}`;

// الـ claim بيتعمل commit على طول، مش بيفضل مفتوح طول التوصيل: consumer واقف كان هيمنع الـ batch يسجّل أي نتيجة،
// والمحاولة مكانتش هتتعد فمكانش هيوصل لحد الـ parking أبداً. فالـ claim بيعد المحاولة ويحجز الـ event لمدة lease
// (next_attempt_at)، ولو الـ dispatcher وقع الـ lease بيخلص والـ event بيتوصل تاني.
// بياخد أقدم event لسه متنشرش لكل aggregate بس، بالـ seq (ترتيب الإدخال) مش created_at (بداية الـ transaction).
// اللي بعده لنفس الـ aggregate مبيتاخدش طول ما ده متنشرش — محجوز أو مستني retry أو parked.
const claimQuery = (limit: number, leaseMs: number) => sql`
  WITH heads AS (
    SELECT o.company_id, o.id FROM outbox o
    WHERE o.published_at IS NULL AND o.parked_at IS NULL AND o.next_attempt_at <= clock_timestamp()
      AND NOT EXISTS (
        SELECT 1 FROM outbox e
        WHERE e.company_id = o.company_id AND e.aggregate_type = o.aggregate_type
          AND e.aggregate_id = o.aggregate_id AND e.published_at IS NULL AND e.seq < o.seq)
    ORDER BY o.seq
    LIMIT ${limit}
    FOR UPDATE OF o SKIP LOCKED)
  UPDATE outbox o
  SET attempts = o.attempts + 1,
      next_attempt_at = clock_timestamp() + ${`${leaseMs} milliseconds`}::interval
  FROM heads h
  WHERE o.company_id = h.company_id AND o.id = h.id
  RETURNING ${RETURNING}`;

// clock_timestamp(): وقت التسجيل الفعلي، فالـ backoff بيبدأ من لحظة الفشل. النتيجة بتتسجل بس لو الـ claim ده
// لسه هو الأخير (attempts = رقم المحاولة) والـ event لسه مفتوح: لو الحجز خلص و dispatcher تاني خده، نتيجة متأخرة
// من الأول متلغيش نشره ولا الـ park بتاعه ولا تقصّر حجزه.
const recordQuery = (event: ClaimedEvent, outcome: DeliveryOutcome) => {
  const fence = sql`company_id = ${event.companyId} AND id = ${event.id} AND attempts = ${event.attempt}
                    AND published_at IS NULL AND parked_at IS NULL`;
  return outcome.delivered
    ? sql`UPDATE outbox SET published_at = clock_timestamp(), last_error = NULL WHERE ${fence}`
    : sql`UPDATE outbox
          SET last_error = ${outcome.error.slice(0, 500)},
              next_attempt_at = clock_timestamp() + ${`${outcome.retryInMs ?? 0} milliseconds`}::interval,
              parked_at = ${outcome.retryInMs === null ? sql`clock_timestamp()` : sql`NULL`}
          WHERE ${fence}`;
};

const toEvent = (row: Row): ClaimedEvent => ({
  companyId: row.company_id,
  id: row.id,
  aggregateType: row.aggregate_type,
  aggregateId: row.aggregate_id,
  eventType: row.event_type,
  payload: row.payload,
  attempt: row.attempts,
});

const validate = (limit: number, leaseMs: number, maxAttempts: number): void => {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) {
    throw new TypeError(`limit must be 1–${MAX_BATCH}`);
  }
  if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new TypeError('leaseMs must be > 0');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be > 0');
  }
};

/**
 * بيفتح pool على pospay_dispatcher ويرجّع الـ facade بس — الـ client بيفضل جوه الـ closure (CLAUDE.md §5).
 * الـ worker بس اللي بيربطه؛ أي role تاني (أو superuser) بيترفض قبل أي شغل.
 *
 * @param options الـ url (لازم يبقى pospay_dispatcher) وحجم الـ pool
 * @param options.url            connection string على pospay_dispatcher
 * @param options.maxConnections حجم الـ pool
 * @returns الـ facade
 */
export function createOutboxDispatcherDatabase(options: {
  url: string;
  maxConnections?: number;
}): OutboxDispatcherDatabase {
  const client = postgres(options.url, {
    max: options.maxConnections ?? 2,
    onnotice: () => undefined,
  });
  const db = drizzle(client);

  const assertRole = async (runner: { execute: typeof db.execute }): Promise<void> => {
    const [row] = await runner.execute<{ role: string; privileged: boolean }>(sql`
      SELECT current_user AS role,
             (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged`);
    if (row?.role !== 'pospay_dispatcher' || row.privileged !== false) {
      throw new Error('The outbox dispatcher must connect as pospay_dispatcher — check its URL');
    }
  };

  return {
    dispatchBatch: async (limit, deliver, dispatchOptions = {}) => {
      const leaseMs = dispatchOptions.leaseMs ?? DEFAULT_LEASE_MS;
      const maxAttempts = dispatchOptions.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      validate(limit, leaseMs, maxAttempts);
      const [exhausted, rows] = await db.transaction(async (tx) => {
        await assertRole(tx);
        const parked = await tx.execute<Row>(exhaustQuery(maxAttempts));
        return [parked, await tx.execute<Row>(claimQuery(limit, leaseMs))] as const;
      });
      if (exhausted.length > 0) dispatchOptions.onExhausted?.(exhausted.map(toEvent));
      const events = rows.map(toEvent);
      // One event per aggregate per batch, so deliveries run side by side. `deliver` reports a consumer's
      // failure as an outcome; a throw means the dispatcher itself failed (a crash): that event stays leased
      // and is redelivered when the lease ends, while the other outcomes are still recorded.
      const settled = await Promise.allSettled(events.map((event) => deliver(event)));
      for (const [index, event] of events.entries()) {
        const result = settled[index];
        if (result?.status === 'fulfilled') await db.execute(recordQuery(event, result.value));
      }
      const crashed = settled.find((result) => result.status === 'rejected');
      if (crashed !== undefined) throw crashed.reason;
      return events.length;
    },
    sweepExpiredIdempotencyKeys: async (batchSize) => {
      const [row] = await db.transaction(async (tx) => {
        await assertRole(tx);
        return tx.execute<{ swept: number }>(
          sql`SELECT sweep_expired_idempotency_keys(${batchSize}) AS swept`,
        );
      });
      return row?.swept ?? 0;
    },
    // /ready: the connection answers AND it is the dispatcher role — a wrong URL or password is not ready.
    ping: () => assertRole(db),
    close: () => client.end({ timeout: 5 }),
  };
}
