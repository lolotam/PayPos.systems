import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
export const MANAGER_PASSKEY_ACCESS = Symbol('MANAGER_PASSKEY_ACCESS');
/** منفذ قراءة الشاشة يظل بجوار الاستعلامات دون اعتماد على طبقة الكتابة. */
export interface ManagerPasskeyAccess {
  /** يثبت الشركة والعضويات بالترتيب المستخدم في التسجيل قبل قفل الموظف. */
  lock(tx: Tx, companyId: string): Promise<boolean>;
  /** يعيد فروع النشاط المسموح بها للشاشة قبل تقسيم الصفحات. */
  list(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<PasskeyAccessDecision>;
  /** يحسب الإذن الحي على كل فروع الموظف المحفوظة دون كشف الهوية العالمية. */
  check(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchIds: readonly string[],
  ): Promise<PasskeyAccessDecision>;
}
export interface PasskeyAccessDecision {
  readBranchIds: string[];
  unbindBranchIds: string[];
  featureEnabled: boolean;
}
// شاشة الموظف تحتاج فروع الربط كلها؛ الفحص يسبق أي كشف للتاريخ أو حالة الميزة.
export function passkeyEmployeeScopeStatement(
  companyId: string,
  businessId: string,
  employeeId: string,
  lock = false,
) {
  return sql`SELECT user_id,primary_branch_id,
    ARRAY(SELECT branch_id FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb."to" IS NULL ORDER BY branch_id) AS branch_ids
    FROM employees e WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL ${lock ? sql`FOR UPDATE` : sql``}`;
}
export async function managerPasskeyEmployee(
  tx: Tx,
  scope: { companyId: string; businessId: string; employeeId: string; userId: string },
  access: ManagerPasskeyAccess,
  lock = false,
) {
  const { companyId, businessId, employeeId, userId } = scope;
  const [employee] = await tx.execute<{
    user_id: string | null;
    primary_branch_id: string;
    branch_ids: string[];
  }>(passkeyEmployeeScopeStatement(companyId, businessId, employeeId, lock));
  if (employee === undefined) return null;
  // قرار المالك 2026-10-04 (UNB-Q3): سلطة على كل الفروع لأن الفك يؤثر على ربط الموظف المشترك.
  const branches = [...new Set([employee.primary_branch_id, ...employee.branch_ids])];
  const decision = await access.check(tx, companyId, userId, businessId, branches);
  if (!branches.every((id) => decision.readBranchIds.includes(id))) return null;
  return {
    featureEnabled: decision.featureEnabled,
    ownBinding: employee.user_id === userId,
    unbindAllowed: branches.every((id) => decision.unbindBranchIds.includes(id)),
  };
}
