import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// مكان الباقة في الفرع: يثبت ملكية الشركة والنشاط والفرع النشط ويرجع توقيت الفرع الفعلي.
// توقيت الفرع مختلف عن توقيت النشاط لما للفرع منطقة خاصة، وصلاحية الباقة تُقاس بيوم الفرع.
export function packageSalePlaceStatement(
  companyId: string,
  businessId: string,
  branchId: string,
) {
  return sql`
    SELECT COALESCE(b.timezone, bu.timezone) AS timezone
    FROM branches b
    JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
    JOIN companies c ON c.id = b.company_id AND c.deleted_at IS NULL
    WHERE b.company_id = ${companyId} AND b.business_id = ${businessId}
      AND b.id = ${branchId} AND b.is_active`;
}

/**
 * يقرأ توقيت الفرع الفعلي بعد إثبات أن الفرع نشط تحت النشاط في الشركة غير المحذوفة.
 *
 * @param tx معاملة المستهلك نفسها
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط الذي أثبته tenancy
 * @param branchId الفرع النشط المطلوب
 * @returns توقيت الفرع الفعلي، أو null إن لم يكن الفرع نشطاً تحت هذا النشاط
 */
export async function packageSalePlace(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ timezone: string | null }>(
    packageSalePlaceStatement(companyId, businessId, branchId),
  );
  return row?.timezone ?? null;
}
