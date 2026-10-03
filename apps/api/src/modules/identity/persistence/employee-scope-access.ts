import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

/**
 * العضوية داخل الشركة وحدها تثبت أهلية الربط؛ وقت العبارة يأتي بعد أقفال الإنشاء لا عند بدء المعاملة.
 *
 * @param tx معاملة الشركة التي تحتفظ بأقفال PR 7
 * @param companyId الشركة المتحقق منها
 * @param userId المستخدم المراد ربطه
 * @returns أهلية الربط دون كشف وجود هوية عالمية أو عضوية لشركة أخرى
 */
export async function employeeUserLinkAvailable(
  tx: Tx,
  companyId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await tx.execute<{ available: boolean }>(sql`
    SELECT EXISTS(SELECT 1 FROM memberships
      WHERE company_id=${companyId} AND user_id=${userId}
        AND starts_at <= statement_timestamp()
        AND (ends_at IS NULL OR ends_at > statement_timestamp())) AS available`);
  return row?.available === true;
}

/**
 * يفحص إذن قراءة الموظف في فرعه المحفوظ قبل كشف السجل أو حالة ميزة الموارد البشرية.
 *
 * @param tx معاملة قراءة السجل داخل الشركة
 * @param companyId الشركة المتحقق منها
 * @param userId القارئ
 * @param businessId نشاط الموظف المحفوظ
 * @param branchId الفرع الأساسي المحفوظ
 * @returns السماح أو الرفض الموحد أو تعطيل الميزة لقارئ مسموح له فقط
 */
export async function readEmployeeDetailAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): Promise<'ALLOWED' | 'DENIED' | 'FEATURE_DISABLED'> {
  const access = await readAccessTransaction(tx, companyId, userId);
  if (
    !evaluateAccess(access.grants, 'manage:employees:business', { companyId, businessId, branchId })
  )
    return 'DENIED';
  return (await readFeatureEnabled(tx, companyId, 'staff')) ? 'ALLOWED' : 'FEATURE_DISABLED';
}

/**
 * يفحص الفروع دفعة واحدة كي لا تصدر شاشة الموظفين استعلام صلاحيات لكل صف.
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المتحقق منها
 * @param userId المدير القارئ أو المعدل
 * @param businessId النشاط المحفوظ
 * @param branchIds الفروع المحفوظة أو المطلوبة
 * @returns الفروع المسموح بها وحالة الميزة دون كشف عضويات أو بيانات هوية
 */
export async function readEmployeeBranchAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchIds: readonly string[],
): Promise<{ allowedBranchIds: string[]; featureEnabled: boolean }> {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return { allowedBranchIds: [], featureEnabled: false };
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  const allowedBranchIds = [...new Set(branchIds)].filter((branchId) =>
    evaluateAccess(access.grants, 'manage:employees:business', { companyId, businessId, branchId }),
  );
  return {
    allowedBranchIds,
    featureEnabled:
      allowedBranchIds.length > 0 && (await readFeatureEnabled(tx, companyId, 'staff')),
  };
}
