import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// نفس شرط الأهلية في staff-eligibility بالظبط: الجهاز لازم يكون فعال ومعتمد وتوكنه لسه صالح، والفرع
// لازم يكون تابع لنفس الشركة. الاختلاف الوحيد هو القفل: القفل بيمنع أي UPDATE على صف الجهاز جوه معاملة
// القرار، فسحب الجهاز أثناء التحقق ما يقدرش يعدّي.
function activeDevice(companyId: string, deviceId: string, branchId: string) {
  return sql`FROM devices d JOIN branches b ON b.company_id=d.company_id AND b.id=d.branch_id
    JOIN companies c ON c.id=d.company_id
    WHERE d.company_id=${companyId} AND d.id=${deviceId} AND d.branch_id=${branchId}
      AND d.status='ACTIVE' AND d.approved_by IS NOT NULL AND d.approved_at IS NOT NULL
      AND d.token_expires_at>clock_timestamp()`;
}

/**
 * بيتأكد إن الجهاز فعال ومعتمد في نفس الشركة والفرع، وبيجيب النشاط بتاع الفرع.
 *
 * @param tx        معاملة الشركة
 * @param companyId الشركة المتحقق منها
 * @param deviceId  الجهاز
 * @param branchId  الفرع
 * @returns معرّف النشاط، أو null لما الجهاز مش فعال
 */
export async function readActiveDeviceBusiness(
  tx: Tx,
  companyId: string,
  deviceId: string,
  branchId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ business_id: string }>(sql`
    SELECT b.business_id ${activeDevice(companyId, deviceId, branchId)}`);
  return row?.business_id ?? null;
}

/**
 * زي readActiveDeviceBusiness، بس بقفل صف الجهاز FOR SHARE — التعليق على الجهاز بيتمنع لحد نهاية المعاملة.
 *
 * @param tx        معاملة القرار
 * @param companyId الشركة المتحقق منها
 * @param deviceId  الجهاز
 * @param branchId  الفرع
 * @returns معرّف النشاط، أو null لما الجهاز مش فعال
 */
export async function lockActiveDeviceBusiness(
  tx: Tx,
  companyId: string,
  deviceId: string,
  branchId: string,
): Promise<string | null> {
  const [row] = await tx.execute<{ business_id: string }>(sql`
    SELECT b.business_id ${activeDevice(companyId, deviceId, branchId)} FOR SHARE OF d`);
  return row?.business_id ?? null;
}

/**
 * بيقفل سطر اعتماد الـ PIN بإصدارة محدّدة، فالتغيير اللي يحصل أثناء القرار ما يقدرش يعدّي.
 *
 * @param tx        معاملة القرار
 * @param companyId الشركة المتحقق منها
 * @param userId    صاحب الاعتماد
 * @param revision  الإصدار اللي اتأكد منه قبل المعاملة
 * @returns true لما السطر موجود للإصدار ده
 */
export async function lockApproverPinRevision(
  tx: Tx,
  companyId: string,
  userId: string,
  revision: string,
): Promise<boolean> {
  const [row] = await tx.execute<{ locked: number }>(sql`
    SELECT 1 AS locked FROM cashier_pins
    WHERE company_id=${companyId} AND user_id=${userId} AND id=${revision} FOR SHARE`);
  return row !== undefined;
}
