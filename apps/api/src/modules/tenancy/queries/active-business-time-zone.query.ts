import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// مكان جلسة الخدمة وإثبات الاسترداد: توقيت النشاط لفرع نشط تحت هذا النشاط في شركة غير محذوفة.
export function activeBusinessTimeZoneStatement(
  companyId: string,
  businessId: string,
  branchId: string,
) {
  return sql`
    SELECT bu.timezone
    FROM branches b
    JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
    JOIN companies c ON c.id = b.company_id AND c.deleted_at IS NULL
    WHERE b.company_id = ${companyId} AND b.business_id = ${businessId}
      AND b.id = ${branchId} AND b.is_active`;
}

export async function activeBusinessTimeZone(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ timezone: string | null }>(
    activeBusinessTimeZoneStatement(companyId, businessId, branchId),
  );
  return row?.timezone ?? null;
}

/**
 * يبني استعلام قراءة توقيت النشاط والتوقيت الفعّال للفرع في جملة واحدة متسقة لقطتياً.
 *
 * @param companyId معرف الشركة
 * @param businessId معرف النشاط
 * @param branchId معرف الفرع النشط
 * @returns استعلام SQL لجلب توقيت النشاط وتوقيت الفرع الفعلي
 */
export function activeSessionPlaceStatement(
  companyId: string,
  businessId: string,
  branchId: string,
) {
  return sql`
    SELECT bu.timezone AS business_timezone,
           COALESCE(b.timezone, bu.timezone) AS branch_timezone
    FROM branches b
    JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
    JOIN companies c ON c.id = b.company_id AND c.deleted_at IS NULL
    WHERE b.company_id = ${companyId} AND b.business_id = ${businessId}
      AND b.id = ${branchId} AND b.is_active`;
}

/**
 * يقرأ توقيت النشاط والتوقيت الفعّال للفرع معاً من لقطة معاملة واحدة لئلا ينحرفا تحت التعديل المتزامن.
 *
 * @param tx معاملة المستهلك
 * @param companyId معرف الشركة
 * @param businessId معرف النشاط
 * @param branchId معرف الفرع النشط
 * @returns توقيت النشاط وتوقيت الفرع الفعلي، أو null عند عدم وجود فرع نشط
 */
export async function activeSessionPlace(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<{ timezone: string; branchTimezone: string } | null> {
  const [row] = await tx.execute<{
    business_timezone: string | null;
    branch_timezone: string | null;
  }>(activeSessionPlaceStatement(companyId, businessId, branchId));
  if (!row?.business_timezone || !row.branch_timezone) return null;
  return { timezone: row.business_timezone, branchTimezone: row.branch_timezone };
}
