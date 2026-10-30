import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
  RatingOptOutBusyError,
  type LockedCustomer,
  type RatingOptOutTransactions,
  type RatingRequestRef,
} from '../ports/rating-opt-out.port.ts';

type RequestRow = { customer_id: string; expires_at: string | null };
type CustomerRow = { opted_out_at: string | null };

// PostgreSQL: query_canceled — مهلة الـ statement أو مهلة انتظار القفل لغت الـ statement.
const PG_QUERY_CANCELED = '57014';

/**
 * القفل ما اتاخدش في الوقت: مهلة المعاملة خلصت، أو نتيجة الـ commit اتلغبطت، أو PostgreSQL لغى الـ statement.
 * دي الحالات التلاتة بس — أي خطأ تاني يعدّي زي ما هو عشان الفشل الحقيقي يفضل متميّز.
 */
function isBusy(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { name?: unknown; code?: unknown; cause?: unknown };
    if (candidate.name === 'TimeoutError' || candidate.name === 'CommitOutcomeUnknownError')
      return true;
    if (candidate.code === PG_QUERY_CANCELED) return true;
    current = candidate.cause;
  }
  return false;
}

async function findRequest(
  tx: Tx,
  companyId: string,
  tokenHash: Buffer,
): Promise<RatingRequestRef | null> {
  const [row] = await tx.execute<RequestRow>(sql`
    SELECT customer_id, expires_at FROM rating_requests
    WHERE company_id = ${companyId} AND token_hash = ${tokenHash}`);
  if (row === undefined || row.expires_at === null) return null;
  return { customerId: row.customer_id, expiresAt: new Date(row.expires_at) };
}

async function lockCustomer(
  tx: Tx,
  companyId: string,
  customerId: string,
): Promise<LockedCustomer | null> {
  // القفل على العميل نفسه: طلبان لنفس التوكن من غير session ما يتزاحموش على صف الطلب.
  const [row] = await tx.execute<CustomerRow>(sql`
    SELECT opted_out_at FROM customers
    WHERE company_id = ${companyId} AND id = ${customerId}
    FOR NO KEY UPDATE`);
  if (row === undefined) return null;
  return { optedOutAt: row.opted_out_at === null ? null : new Date(row.opted_out_at) };
}

async function markOptedOut(
  tx: Tx,
  companyId: string,
  customerId: string,
  at: Date,
): Promise<boolean> {
  const stamp = at.toISOString();
  // الشرط على opted_out_at IS NULL بيخلي الكتابة مرة واحدة بس، والحراسة في القاعدة بتمنع أي تغيير بعدين.
  const rows = await tx.execute<{ id: string }>(sql`
    UPDATE customers SET opted_out_at = ${stamp}, updated_at = ${stamp}
    WHERE company_id = ${companyId} AND id = ${customerId} AND opted_out_at IS NULL
    RETURNING id`);
  return rows.length > 0;
}

/**
 * معاملة رفض التقييم: بتعمل جوه الشركة المختارة من بادئة الرابط، من غير مستخدم (ADR-0011 §1).
 * الطلب بيتقري من غير قفل، والعميل بيتقفل بـ `FOR NO KEY UPDATE` — الاعتماد على صف العميل مش على صف الطلب.
 *
 * @param db        أغلفة الداتابيز المستأجرة
 * @param ids       مولّد الـ ids لسجل التدقيق
 * @param timeoutMs أقصى عمر للمعاملة كلها، عشان القفل ما يعلّقش الطلب
 * @returns معاملة رفض التقييم
 */
export function createRatingOptOutTransactions(
  db: TenantWrappers,
  ids: IdGenerator,
  timeoutMs: number,
): RatingOptOutTransactions {
  return {
    run: async (companyId, work) => {
      try {
        return await db.withTenant(
          companyId,
          async (tx) =>
            work({
              audit: { record: (entry) => appendAuditLog(tx, ids.newId(), entry) },
              findRequest: (tokenHash) => findRequest(tx, companyId, tokenHash),
              lockCustomer: (customerId) => lockCustomer(tx, companyId, customerId),
              markOptedOut: (customerId, at) => markOptedOut(tx, companyId, customerId, at),
            }),
          { timeoutMs },
        );
      } catch (error) {
        if (error instanceof RatingOptOutBusyError) throw error;
        if (isBusy(error)) throw new RatingOptOutBusyError();
        throw error;
      }
    },
  };
}
