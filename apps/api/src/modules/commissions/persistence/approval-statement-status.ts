import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * يقرأ حالة كشف شهر بلا قفل ولا إنشاء (فحص مبكر قبل قفل الشهور): صف الكشف بنشاطه وشهره في سياق الشركة.
 *
 * @param tx معاملة الاعتماد
 * @param businessId النشاط
 * @param period الشهر بصيغة YYYY-MM
 * @returns الحالة، أو null لو لا كشف
 */
export async function readApprovalStatementStatus(
  tx: Tx,
  businessId: string,
  period: string,
): Promise<'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID' | null> {
  const [row] = await tx.execute<{ status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID' }>(
    sql`SELECT status FROM commission_statements WHERE business_id = ${businessId} AND period = ${period}`,
  );
  return row?.status ?? null;
}
