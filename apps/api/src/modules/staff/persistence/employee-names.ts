import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * يعيد اسم الموظفة النشطة المرتبطة بالمستخدم داخل النشاط نفسه فقط.
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة المؤكدة
 * @param businessId نشاط السطر
 * @param userId مستخدمة التعديل
 * @returns الاسمان أو null إذا لم توجد موظفة نشطة في هذا النشاط
 */
export async function employeeNamesByUser(
  tx: Tx,
  companyId: string,
  businessId: string,
  userId: string,
): Promise<{ name_ar: string | null; name_en: string } | null> {
  const [row] = await tx.execute<{ name_ar: string | null; name_en: string }>(sql`
    SELECT name_ar, name_en FROM employees
    WHERE company_id=${companyId} AND business_id=${businessId} AND user_id=${userId} AND deleted_at IS NULL`);
  return row ?? null;
}
