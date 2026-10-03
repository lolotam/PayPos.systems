import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * بيقرأ افتراضي الخصم من نفس معاملة تسجيل الخدمة بدون نسخة Redis قديمة.
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
    SELECT limit_bps FROM business_settings WHERE company_id=${companyId} AND business_id=${businessId}`);
  return row?.limit_bps ?? null;
}
