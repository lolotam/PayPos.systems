import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// مكان بيع الباقة وإثبات ملكيته: توقيت الفرع ولو ما كانش متظبط ناخد توقيت النشاط، في شركة غير محذوفة.
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
 * يثبت إن الفرع تابع للشركة والنشاط ومش متوقف، وبيرجع توقيت البيع الفعلي.
 * القراءة على معاملة المستدعي نفسها عشان ما يحصلش قفل تاني أو معاملة تانية.
 *
 * @param tx معاملة الشركة المستهلكة
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط الذي أثبته المسار
 * @param branchId فرع البيع
 * @returns توقيت الفرع مع الرجوع لتوقيت النشاط، أو null لو الفرع مش صالح للبيع
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
