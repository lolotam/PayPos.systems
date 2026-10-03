import { employeeDetailRecord, type EmployeeDetail } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const EMPLOYEE_DETAIL_ACCESS = Symbol('EMPLOYEE_DETAIL_ACCESS');
/** منفذ القراءة بجوار الاستعلام مثل WorkspaceNames، حتى لا يعتمد مسار القراءة على ports/ أو domain/. */
export interface EmployeeDetailAccess {
  /** يحسب فروع القائمة قبل تقسيم الصفحات كي لا تحمل المؤشرات معرفات موظفين ممنوعين. */
  listScope(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<{ allowedBranchIds: string[]; featureEnabled: boolean }>;
  /** يثبت نطاقات الشاشة دفعة واحدة، دون استعلام صلاحيات لكل موظف. */
  checkMany(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchIds: readonly string[],
  ): Promise<{ allowedBranchIds: string[]; featureEnabled: boolean }>;
  /** يفحص النطاق المحفوظ داخل نفس معاملة القراءة؛ المنع يسبق كشف السجل أو حالة الميزة. */
  check(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
    branchId: string,
  ): Promise<'ALLOWED' | 'DENIED' | 'FEATURE_DISABLED'>;
}

// شاشة تأكيد الموظف؛ لا يخرج الإسقاط إلا بعد فحص الإذن عند كل الفروع المحفوظة، والرفض يشبه الغياب.
export async function employeeDetail(
  tx: Tx,
  companyId: string,
  businessId: string,
  employeeId: string,
  userId: string,
  access: EmployeeDetailAccess,
): Promise<EmployeeDetail | 'FEATURE_DISABLED' | null> {
  const [row] = await tx.execute<{
    business_id: string;
    primary_branch_id: string;
    branch_ids: string[];
  }>(sql`SELECT id, business_id, primary_branch_id, user_id, name_ar, name_en, revision,
    ARRAY(SELECT eb.branch_id FROM employee_branches eb WHERE eb.company_id=employees.company_id AND eb.employee_id=employees.id AND eb."to" IS NULL ORDER BY eb.branch_id) AS branch_ids,
    role_code, to_char(hire_date, 'YYYY-MM-DD') AS hire_date, to_char(contract_end, 'YYYY-MM-DD') AS contract_end,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    FROM employees WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL`);
  if (row === undefined) return null;
  const scopeBranches = [...row.branch_ids, row.primary_branch_id];
  const decision = await access.checkMany(tx, companyId, userId, row.business_id, scopeBranches);
  if (!scopeBranches.every((branch) => decision.allowedBranchIds.includes(branch))) return null;
  if (!decision.featureEnabled) return 'FEATURE_DISABLED';
  return employeeDetailRecord.parse(row);
}
