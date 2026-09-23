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
  /** عدد المحاولات اللي فاتت قبل المحاولة دي. */
  readonly attempts: number;
}

/**
 * نتيجة توصيل event واحد: اتوصل، أو فشل ومعاه إمتى المحاولة الجاية (null = يقف parked).
 */
export type DeliveryOutcome =
  | { readonly delivered: true }
  | { readonly delivered: false; readonly error: string; readonly retryInMs: number | null };

/**
 * الـ facade المحدود بتاع الـ dispatcher (ADR-0003 §3): ياخد batch، يسجّل النتيجة، ينضّف مفاتيح الـ idempotency
 * القديمة، ويقفل الـ pool — ومفيش أي طريقة تانية يوصل بيها لأي جدول.
 */
export interface OutboxDispatcherDatabase {
  dispatchBatch(
    limit: number,
    deliver: (event: ClaimedEvent) => Promise<DeliveryOutcome>,
  ): Promise<number>;
  sweepExpiredIdempotencyKeys(batchSize: number): Promise<number>;
  close(): Promise<void>;
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

// أقدم event لسه متنشرش لكل aggregate بس (الترتيب per aggregate — Waleed، 2026-09-23): لو فيه event أقدم لنفس
// الـ aggregate لسه متنشرش — مستني retry أو parked — اللي بعده مبيتاخدش. SKIP LOCKED بيخلي dispatcherين مع بعض
// ياخدوا batches مختلفة من غير ما حد يستنى التاني، والـ lock بيفضل لحد ما النتيجة تتسجل في نفس الـ transaction.
const claimQuery = (limit: number) => sql`
  SELECT o.company_id, o.id, o.aggregate_type, o.aggregate_id, o.event_type, o.payload, o.attempts
  FROM outbox o
  WHERE o.published_at IS NULL AND o.parked_at IS NULL AND o.next_attempt_at <= now()
    AND NOT EXISTS (
      SELECT 1 FROM outbox e
      WHERE e.company_id = o.company_id AND e.aggregate_type = o.aggregate_type
        AND e.aggregate_id = o.aggregate_id AND e.published_at IS NULL
        AND (e.created_at, e.id) < (o.created_at, o.id))
  ORDER BY o.created_at, o.id
  LIMIT ${limit}
  FOR UPDATE OF o SKIP LOCKED`;

const recordQuery = (event: ClaimedEvent, outcome: DeliveryOutcome) =>
  outcome.delivered
    ? sql`UPDATE outbox SET published_at = now(), attempts = attempts + 1, last_error = NULL
          WHERE company_id = ${event.companyId} AND id = ${event.id}`
    : sql`UPDATE outbox
          SET attempts = attempts + 1, last_error = ${outcome.error.slice(0, 500)},
              next_attempt_at = now() + ${`${outcome.retryInMs ?? 0} milliseconds`}::interval,
              parked_at = ${outcome.retryInMs === null ? sql`now()` : sql`NULL`}
          WHERE company_id = ${event.companyId} AND id = ${event.id}`;

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

  const assertRole = async (tx: { execute: typeof db.execute }) => {
    const [row] = await tx.execute<{ role: string; privileged: boolean }>(sql`
      SELECT current_user AS role,
             (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged`);
    if (row?.role !== 'pospay_dispatcher' || row.privileged !== false) {
      throw new Error('The outbox dispatcher must connect as pospay_dispatcher — check its URL');
    }
  };

  return {
    dispatchBatch: (limit, deliver) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) {
        return Promise.reject(new TypeError(`limit must be 1–${MAX_BATCH}`));
      }
      return db.transaction(async (tx) => {
        await assertRole(tx);
        const rows = await tx.execute<Row>(claimQuery(limit));
        const events: ClaimedEvent[] = rows.map((row) => ({
          companyId: row.company_id,
          id: row.id,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          eventType: row.event_type,
          payload: row.payload,
          attempts: row.attempts,
        }));
        // One event per aggregate per batch, so deliveries run side by side. `deliver` reports a consumer's failure
        // as an outcome; a throw means the dispatcher itself failed (a crash) and rolls the batch back unrecorded:
        // every event in it is redelivered, and the consumers' dedupe rows stop committed effects applying twice.
        // allSettled: the batch ends only when every delivery has, so none is still running after the rollback.
        const settled = await Promise.allSettled(events.map((event) => deliver(event)));
        const crashed = settled.find((result) => result.status === 'rejected');
        if (crashed !== undefined) throw crashed.reason;
        for (const [index, event] of events.entries()) {
          const result = settled[index];
          if (result?.status === 'fulfilled') await tx.execute(recordQuery(event, result.value));
        }
        return events.length;
      });
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
    close: () => client.end({ timeout: 5 }),
  };
}
