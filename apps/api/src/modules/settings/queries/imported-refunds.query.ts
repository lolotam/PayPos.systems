import type { ImportedRefundsResponse } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * بيجيب القيمة المخزنة لمفتاح مرتجع الباقات المستوردة من غير قفل ومن غير ما يعمل صف،
 * وبرجّع القيمة الفعلية: صف غايب و NULL و false كلهم off.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة
 * @param businessId النشاط
 * @returns القيمة الفعلية للمفتاح
 */
export async function importedRefundsQuery(
  tx: Tx,
  companyId: string,
  businessId: string,
): Promise<ImportedRefundsResponse> {
  // شاشة مفتاح مرتجع الباقات المستوردة في لوحة الإدارة هي المستهلك.
  const [row] = await tx.execute<{ imported_refunds_enabled: boolean | null }>(sql`
    SELECT imported_refunds_enabled FROM business_settings
    WHERE company_id = ${companyId}::uuid AND business_id = ${businessId}::uuid`);
  return { imported_refunds_enabled: row?.imported_refunds_enabled === true };
}
