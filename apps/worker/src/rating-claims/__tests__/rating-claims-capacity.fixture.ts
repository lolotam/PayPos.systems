// أدوات قياس السعة: الزرع التاريخي، ومعاملات مقيسة، والنسب المئوية.
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import type { Tx } from '@pospay/db';

import type { DueRatingRequest } from '../../modules/customers/ports/rating-claim.repository.ts';
import type { RatingClaimTransactions } from '../../modules/customers/ports/rating-claim-transactions.port.ts';
import type { RatingClaimsTurnSummary } from '../../modules/customers/use-cases/claim-rating-requests/claim-rating-requests.ts';
import type { RatingClaimsWorld } from './rating-claims-world.fixture.ts';

/** دور واحد مقيس: زمن التفعيل ومدة الدور وملخص الدور. */
export interface TurnRun {
  readonly companyId: string;
  readonly enqueueToActiveMs: number;
  readonly durationMs: number;
  readonly summary: RatingClaimsTurnSummary;
}

/**
 * صفوف تاريخية (SENT وCANCELLED) بتتخطى الجولة، عشان القياس يشوف الحجم الحقيقي.
 *
 * الصف التاريخي يتولد مجدولاً (القاعدة بتمنع إنشاء طلب مُرسَل من غير مطالبة)،
 * وبعدين بيتحول لمُرسَل أو ملغي بخطوتين تلتزم بالقيود.
 *
 * @param owner اتصال المالك
 * @param company الشركة
 * @param business النشاط
 * @param branch الفرع
 * @returns لا شيء
 */
export async function historyOf(
  owner: postgres.Sql,
  company: string,
  business: string,
  branch: string,
): Promise<void> {
  const rows = 60;
  await owner`WITH picked AS (
      SELECT id, (row_number() OVER ())::int AS n FROM customers WHERE company_id = ${company} LIMIT ${rows})
    INSERT INTO rating_requests (company_id,id,business_id,customer_id,business_date,branch_id,due_at,status)
    SELECT ${company}, gen_random_uuid(), ${business}, picked.id,
      (date '2026-03-01' + (picked.n % 28))::date, ${branch}, '2026-05-01T00:00:00Z'::timestamptz, 'SCHEDULED'
    FROM picked`;
  await owner`UPDATE rating_requests SET status = 'SENDING',
      token_hash = sha256(random()::text::bytea), token_key_version = 1,
      expires_at = '2026-05-02T00:00:00Z'::timestamptz + interval '168 hours',
      claimed_at = '2026-05-02T00:00:00Z'::timestamptz, ready_event_id = gen_random_uuid()
    WHERE company_id = ${company} AND status = 'SCHEDULED' AND business_date < date '2026-04-01'`;
  await owner`UPDATE rating_requests SET status = 'SENT', sent_at = '2026-05-03T00:00:00Z'::timestamptz
    WHERE company_id = ${company} AND status = 'SENDING' AND business_date < date '2026-04-01'`;
  await owner`WITH picked AS (
      SELECT id, (row_number() OVER ())::int AS n FROM customers WHERE company_id = ${company} LIMIT ${rows})
    INSERT INTO rating_requests (company_id,id,business_id,customer_id,business_date,branch_id,due_at,
      status,cancel_reason)
    SELECT ${company}, gen_random_uuid(), ${business}, picked.id, (date '2026-04-01' + (picked.n % 28))::date,
      ${branch}, '2026-05-01T00:00:00Z'::timestamptz, 'CANCELLED', 'NO_ACTIVE_LINE'
    FROM picked`;
}

/**
 * معاملات مقيسة: زمن الانتظار لحد الـ commit، وعدّ الأخطاء.
 *
 * @param world عالم القبول
 * @param samples العيّنة اللي بتتملى بزمن كل معاملة
 * @param failures الأخطاء اللي حصلت��
 * @param firstStart أول لحظة معاملة في الدور
 * @returns منافذ المعاملات المقيسة
 */
export function measured(
  world: RatingClaimsWorld,
  samples: number[],
  failures: number[],
  firstStart: number[],
): RatingClaimTransactions<Tx> {
  return {
    ...world.transactions,
    withRequest: async <T>(
      companyId: string,
      requestId: string,
      work: (tx: Tx, request: DueRatingRequest | null) => Promise<T>,
    ): Promise<T> => {
      const started = performance.now();
      if (firstStart.length === 0) firstStart.push(started);
      try {
        return await world.transactions.withRequest(companyId, requestId, work);
      } catch (error) {
        failures.push(1);
        throw error;
      } finally {
        samples.push(performance.now() - started);
      }
    },
  };
}

/**
 * النسب المئوية للعيّنة.
 *
 * @param values العيّنة
 * @returns p50 وp95 وp99 وعدد العيّنات
 */
export function percentiles(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), samples: sorted.length };
}

/**
 * دور واحد مقيس: من بداية الدور لحد أول معاملة، ومدة الدور كلها.
 *
 * @param world عالم القبول
 * @param companyId الشركة
 * @param samples العيّنة
 * @param failures الأخطاء
 * @returns الدور المقيس
 */
export async function turn(
  world: RatingClaimsWorld,
  companyId: string,
  samples: number[],
  failures: number[],
): Promise<TurnRun> {
  const firstStart: number[] = [];
  const worker = world.worker({ transactions: measured(world, samples, failures, firstStart) });
  const started = performance.now();
  const summary = await worker.execute(companyId);
  return {
    companyId,
    enqueueToActiveMs: (firstStart[0] ?? started) - started,
    durationMs: performance.now() - started,
    summary,
  };
}

/**
 * استعلامات مزاحمة على نفس الـ pool.
 *
 * @param world عالم القبول
 * @param count عدد الاستعلامات المتوازية
 * @returns لا شيء
 */
export async function competingQueries(world: RatingClaimsWorld, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, () =>
      world.base.db.withTenant(world.company, async (tx) => {
        await tx.execute(
          sql`SELECT id FROM rating_requests WHERE company_id = ${world.company}
            AND status = 'SCHEDULED' ORDER BY id LIMIT 25`,
        );
      }),
    ),
  );
}
