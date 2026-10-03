import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * بيثبت افتراضي الخصم بقفل SHARE بعد قفل العضوية، قبل قراءة الحد الشخصي في نفس المعاملة.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المؤكد
 * @returns الحد المخزن أو null لو النشاط لم يضبط حدًا
 */
export async function readBusinessDiscountDefault(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<number | null> {
  // شاشة إعدادات النشاط وتسجيل الخدمة في PR 35 يحتاجان قيمة النشاط الحالية بمفتاحه.
  const [row] = await tx.execute<{ limit_bps: number | null }>(sql`
    SELECT limit_bps FROM business_settings WHERE company_id=${companyId} AND business_id=${businessId} FOR SHARE`);
  return row?.limit_bps ?? null;
}
