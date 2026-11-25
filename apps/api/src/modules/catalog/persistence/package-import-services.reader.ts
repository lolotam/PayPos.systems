import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** أسماء الخدمات المفتوحة للنشاط لورقة مرجع قالب استيراد الباقات (SI-Q28: المقفولة لا تظهر ولا تُستورد). */
export type PackageImportTemplateServiceName = {
  readonly name_en: string;
  readonly name_ar: string | null;
};

/**
 * يقرأ أسماء الخدمات المفتوحة للنشاط على معاملة الشركة نفسها بالترتيب الثابت للقالب؛ السقف الاختياري
 * يحمي القراءة من نشاط بآلاف الخدمات فيرفض المستهلك بدل أن يحمّل الكل.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المؤكد
 * @param limit أقصى عدد صفوف يُقرأ، أو بلا سقف عند الغياب
 * @returns الخدمات المفتوحة مرتبة بالاسم الإنجليزي ثم الهوية
 */
export async function readPackageImportTemplateServices(
  tx: Tx,
  companyId: string,
  businessId: string,
  limit?: number,
): Promise<readonly PackageImportTemplateServiceName[]> {
  const cap = limit === undefined ? sql`` : sql`LIMIT ${limit}`;
  return tx.execute<PackageImportTemplateServiceName>(sql`
    SELECT name_en, name_ar FROM services
    WHERE company_id=${companyId} AND business_id=${businessId} AND closed_at IS NULL
    ORDER BY name_en, id ${cap}`);
}
