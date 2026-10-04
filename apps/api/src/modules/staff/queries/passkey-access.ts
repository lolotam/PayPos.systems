import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
export const MANAGER_PASSKEY_ACCESS = Symbol('MANAGER_PASSKEY_ACCESS');
/** منفذ قراءة الشاشة يظل بجوار الاستعلامات دون اعتماد على طبقة الكتابة. */
export interface ManagerPasskeyAccess {
  /** يعيد لحظة واحدة للفحص كي تتفق الارتباطات والأذونات وانتهاء تجاوز الميزة. */
  now(): Date;
  /** يثبت الشركة والعضويات بالترتيب المستخدم في التسجيل قبل قفل الموظف. */
  lock(tx: Tx, companyId: string): Promise<boolean>;
  /** يعيد فروع النشاط المسموح بها للشاشة قبل تقسيم الصفحات. */
  list(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    now: Date,
  ): Promise<PasskeyAccessDecision>;
  /** يحسب الإذن الحي على كل فروع الموظف المحفوظة دون كشف الهوية العالمية. */
  check(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchIds: readonly string[],
    now: Date,
  ): Promise<PasskeyAccessDecision>;
  /** يعيد اليوم المحلي لكل فرع في النشاط من الساعة المحقونة، لأن نهاية الارتباط تاريخ محلي للفرع. */
  branchDays(tx: Tx, companyId: string, businessId: string, now: Date): Promise<BranchDay[]>;
}
export interface PasskeyAccessDecision {
  readBranchIds: string[];
  unbindBranchIds: string[];
  featureEnabled: boolean;
}
export interface BranchDay {
  branchId: string;
  today: string;
}
// النهاية مستبعدة والارتباط المستقبلي محسوب؛ فرع بلا يوم معروف محسوب أيضاً فيُرفض الشك ولا يُسمح به.
export function currentAttachment(days: readonly BranchDay[]) {
  const ids = sql`ARRAY[${sql.join(
    days.map((day) => sql`${day.branchId}::uuid`),
    sql`,`,
  )}]::uuid[]`;
  const dates = sql`ARRAY[${sql.join(
    days.map((day) => sql`${day.today}::date`),
    sql`,`,
  )}]::date[]`;
  return sql`(eb."to" IS NULL OR eb."to" > COALESCE((SELECT d.today FROM unnest(${ids},${dates}) AS d(branch_id,today) WHERE d.branch_id=eb.branch_id),'-infinity'::date))`;
}
// شاشة الموظف تحتاج فروع الربط الحالية كلها؛ الفحص يسبق أي كشف للتاريخ أو حالة الميزة.
export function passkeyEmployeeScopeStatement(
  scope: { companyId: string; businessId: string; employeeId: string; userId: string },
  days: readonly BranchDay[],
  lock = false,
) {
  const { companyId, businessId, employeeId, userId } = scope;
  return sql`SELECT user_id,primary_branch_id,
    ARRAY(SELECT branch_id FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND ${currentAttachment(days)} ORDER BY branch_id) AS branch_ids,
    EXISTS(SELECT 1 FROM employee_passkeys p WHERE p.company_id=e.company_id AND p.employee_id=e.id AND p.unbound_at IS NULL AND p.bound_by=${userId}) AS bound_by_actor
    FROM employees e WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL ${lock ? sql`FOR UPDATE` : sql``}`;
}
export async function managerPasskeyEmployee(
  tx: Tx,
  scope: { companyId: string; businessId: string; employeeId: string; userId: string },
  access: ManagerPasskeyAccess,
  lock = false,
) {
  const { companyId, businessId, userId } = scope;
  const now = access.now();
  const days = await access.branchDays(tx, companyId, businessId, now);
  const [employee] = await tx.execute<{
    user_id: string | null;
    primary_branch_id: string;
    branch_ids: string[];
    bound_by_actor: boolean;
  }>(passkeyEmployeeScopeStatement(scope, days, lock));
  if (employee === undefined) return null;
  // قرار المالك 2026-10-04 (UNB-Q3): سلطة على كل الفروع لأن الفك يؤثر على ربط الموظف المشترك.
  const branches = [...new Set([employee.primary_branch_id, ...employee.branch_ids])];
  const decision = await access.check(tx, companyId, userId, businessId, branches, now);
  if (!branches.every((id) => decision.readBranchIds.includes(id))) return null;
  return {
    featureEnabled: decision.featureEnabled,
    // من سجّل الربط النشط يظل صاحبه حتى لو أعيد ربط الموظف بمستخدم آخر.
    ownBinding: employee.user_id === userId || employee.bound_by_actor,
    unbindAllowed: branches.every((id) => decision.unbindBranchIds.includes(id)),
  };
}
