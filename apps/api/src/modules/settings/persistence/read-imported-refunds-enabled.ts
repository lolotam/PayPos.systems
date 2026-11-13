import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * يقرأ مفتاح استرداد الباقات المستوردة من إعدادات النشاط على معاملة المستدعي نفسها.
 * القراءة ما بتعملش صف: غياب الصف يعني إن النشاط لسه ما فعّلش المفتاح، والقيمة المخزنة null أو false معناها مقفول.
 *
 * @param tx معاملة الشركة المستهلكة
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط الذي استُردت فيه الباقة
 * @returns true بس لما القيمة المخزنة true
 */
export async function readImportedRefundsEnabled(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<boolean> {
  const [row] = await tx.execute<{ imported_refunds_enabled: boolean | null }>(sql`
    SELECT imported_refunds_enabled
    FROM business_settings
    WHERE company_id = ${companyId}::uuid AND business_id = ${businessId}::uuid`);
  return row?.imported_refunds_enabled === true;
}
