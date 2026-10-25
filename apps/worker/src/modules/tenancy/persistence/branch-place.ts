import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

/**
 * اسم الفرع ومنطقته وأسماء النشاط كما يقرأها مسار كشف الحضور؛ المنطقة الفعّالة للفرع
 * وإلا للنشاط (PRD D-10). أسماء النشاط هي آخر ملجأ لاسم رأس البيان.
 */
export interface BranchPlaceRead {
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly timeZone: string;
  readonly businessNameAr: string | null;
  readonly businessNameEn: string;
}

/**
 * اسم الفرع وأسماء النشاط ومنطقته الزمنية الفعّالة، من جداول التينانسي على معاملة المستدعي.
 *
 * @param tx معاملة الشركة المجدولة
 * @param companyId الشركة
 * @param businessId النشاط
 * @param branchId الفرع
 * @returns المكان أو null إن لم يوجد الفرع
 */
export async function branchPlace(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<BranchPlaceRead | null> {
  const rows = await tx.execute<{
    name_ar: string | null;
    name_en: string;
    branch_timezone: string | null;
    business_timezone: string;
    business_name_ar: string | null;
    business_name_en: string;
  }>(sql`SELECT b.name_ar, b.name_en, b.timezone AS branch_timezone, bu.timezone AS business_timezone,
      bu.name_ar AS business_name_ar, bu.name_en AS business_name_en
    FROM branches b
    JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
    WHERE b.company_id = ${companyId} AND b.business_id = ${businessId} AND b.id = ${branchId}`);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    nameAr: row.name_ar,
    nameEn: row.name_en,
    timeZone: row.branch_timezone ?? row.business_timezone,
    businessNameAr: row.business_name_ar,
    businessNameEn: row.business_name_en,
  };
}
