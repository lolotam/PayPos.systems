import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { evaluateAccess } from '../domain/access.ts';
import { readAccessTransaction } from './access-reader.ts';
import { readFeatureEnabled } from './feature-reader.ts';

// نفس بروتوكول PR 7: تثبيت العضويات يحمي الإنشاء من تغير الإذن أثناء الانتظار.
export async function lockEmployeeCreationAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): Promise<boolean> {
  if (!(await lockEmployeeManagementLocks(tx, companyId))) return false;
  return evaluateEmployeeManagement(tx, companyId, userId, businessId, branchId);
}

/**
 * يقفل الإذن على نطاق النشاط كله بلا فرع معيّن؛ استيراد الموظفين يمنح على مستوى النشاط.
 *
 * @param tx معاملة الشركة التي تحتفظ بأقفال PR 7
 * @param companyId الشركة المتحقق منها
 * @param userId المدير المستورد
 * @param businessId النشاط المستهدف
 * @returns هل يملك إدارة الموظفين في هذا النشاط وهل ميزة الموارد البشرية مفعّلة
 */
export async function lockEmployeeManagementAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<{ manage: boolean; featureEnabled: boolean }> {
  if (!(await lockEmployeeManagementLocks(tx, companyId)))
    return { manage: false, featureEnabled: false };
  return readEmployeeManagementAccess(tx, companyId, userId, businessId);
}

/**
 * يقرأ إذن إدارة الموظفين الحي دون أقفال كتابة لكي لا تعطل المعاينة محرري العضويات.
 *
 * @param tx معاملة القراءة داخل الشركة
 * @param companyId الشركة المتحقق منها
 * @param userId المدير
 * @param businessId النشاط المطلوب
 * @returns الإذن وحالة ميزة الموظفين
 */
export async function readEmployeeManagementAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
) {
  const manage = await evaluateEmployeeManagement(tx, companyId, userId, businessId, undefined);
  return {
    manage,
    featureEnabled: manage && (await readFeatureEnabled(tx, companyId, 'staff')),
  };
}

async function lockEmployeeManagementLocks(tx: Tx, companyId: string): Promise<boolean> {
  const [company] = await tx.execute(
    sql`SELECT id FROM companies WHERE id=${companyId} AND deleted_at IS NULL FOR NO KEY UPDATE`,
  );
  if (company === undefined) return false;
  await tx.execute(
    sql`SELECT id FROM memberships WHERE company_id=${companyId} ORDER BY id FOR UPDATE`,
  );
  return true;
}

async function evaluateEmployeeManagement(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string | undefined,
): Promise<boolean> {
  const [time] = await tx.execute<{ at: Date }>(sql`SELECT clock_timestamp() AS at`);
  if (time === undefined) return false;
  const access = await readAccessTransaction(tx, companyId, userId, new Date(time.at));
  return evaluateAccess(access.grants, 'manage:employees:business', {
    companyId,
    businessId,
    ...(branchId === undefined ? {} : { branchId }),
  });
}
