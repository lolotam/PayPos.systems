import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * بيؤكد النشاط وفروعه لقارئ حد الخصم؛ identity لا ينضم لجداول tenancy.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط المطلوب
 * @returns النشاط المؤكد وفروعه أو نطاق غير موجود
 */
export async function businessDiscountScope(tx: Tx, companyId: string, businessId: string) {
  const [row] = await tx.execute<{ business_id: string; branch_ids: string[] }>(sql`
    SELECT b.id AS business_id, array_remove(array_agg(br.id), NULL) AS branch_ids
    FROM businesses b LEFT JOIN branches br ON br.company_id=b.company_id AND br.business_id=b.id
    WHERE b.company_id=${companyId} AND b.id=${businessId} GROUP BY b.id`);
  return { businessId: row?.business_id ?? null, branchIds: row?.branch_ids ?? [] };
}
