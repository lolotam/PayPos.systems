import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * يقول إن الموظفة موجودة في النشاط وباقية، من غير قفل صف.
 * القراءة البحتة ما بتحجزش صف: القفل على الموظفة ملك الكتابة بس.
 *
 * @param tx         معاملة القراءة الحالية
 * @param companyId  الشركة
 * @param businessId النشاط
 * @param employeeId الموظفة المطلوبة
 * @returns true عند وجود الموظفة النشطة في النشاط
 */
export async function employeeExistsInBusiness(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`SELECT id FROM employees
    WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId}
      AND deleted_at IS NULL LIMIT 1`);
  return rows.length === 1;
}
