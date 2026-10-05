import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * منطقة النشاط الزمنية للمهام العاملة بلا جلسة (وظيفة انتهاء الوثائق)؛ نفس قراءة API tenancy.
 *
 * @param tx معاملة الشركة المجدولة
 * @param companyId الشركة
 * @param businessId النشاط
 * @returns المنطقة أو null إن لم يوجد النشاط
 */
export async function businessTimeZone(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<string | null> {
  const rows = await tx.execute<{ timezone: string }>(sql`SELECT timezone FROM businesses
    WHERE company_id=${companyId} AND id=${businessId}`);
  return rows[0]?.timezone ?? null;
}
