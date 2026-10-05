import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** الفرع يثبت إعداد الحضور أثناء الحركة؛ timezone/geo لا يقرأهما staff مباشرة. */
export async function attendanceBranch(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
) {
  const [row] = await tx.execute<{ timezone: string; lat: number | null; lng: number | null }>(
    attendanceBranchStatement(companyId, businessId, branchId),
  );
  return row ?? null;
}
/** نفس مسار القراءة يستخدمه إثبات خطة PK تحت RLS في الاختبار. */
export function attendanceBranchStatement(companyId: string, businessId: string, branchId: string) {
  return sql`
    SELECT COALESCE(b.timezone,bu.timezone,'Asia/Kuwait') AS timezone,b.geo_lat AS lat,b.geo_lng AS lng
    FROM branches b JOIN businesses bu ON bu.company_id=b.company_id AND bu.id=b.business_id
    WHERE b.company_id=${companyId} AND b.id=${branchId} AND b.business_id=${businessId} AND b.is_active
    FOR SHARE OF b,bu`;
}
