import { type Tx, currentAttachment, type BranchDay, employeeDefaultShiftsStatement } from '@pospay/db';
import { employeeDefaultShifts as view } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type { EmployeeDetailAccess } from './employee-detail.query.ts';
export { employeeDefaultShiftsStatement } from '@pospay/db';

export const EMPLOYEE_HOURS_READ_ACCESS = Symbol('EMPLOYEE_HOURS_READ_ACCESS');
export interface EmployeeHoursReadAccess {
  detail: EmployeeDetailAccess;
  /** يعيد فروع النشاط وتوقيتها لعرض الدوام المحفوظ حتى بعد انتهاء الارتباط. */
  branches(tx: Tx, companyId: string, businessId: string): Promise<{ id: string; timezone: string }[]>;
  /** يفحص إدارة فروع الموظفة ويعيد الفروع المرشحة المسموحة لحجب الدوام خارج نطاق القارئ. */
  manage(tx: Tx, companyId: string, userId: string, businessId: string,
    branchIds: readonly string[], candidateBranchIds: readonly string[]):
    Promise<{ manage: boolean; featureEnabled: boolean; allowedBranchIds: string[] }>;
}
export interface EmployeeHoursReadContext {
  companyId: string; userId: string; businessId: string; employeeId: string;
}

// فروع الارتباط الحالية بتوقيت كل فرع، ومعها الفروع ذات الدوام المحفوظ حتى بعد فك الارتباط.
export async function employeeDefaultShifts(tx: Tx, context: EmployeeHoursReadContext,
  access: EmployeeHoursReadAccess, managedBranchId: string | null = null) {
  const branchContexts = await access.branches(tx, context.companyId, context.businessId);
  const days = await branchDays(tx, branchContexts);
  // يعاد فحص فروع السجل داخل معاملة القراءة؛ أي ارتباط لم ينته بعد بتوقيت فرعه يدخل الفحص،
  // ومنه الارتباط الحالي بتاريخ نهاية لاحق، فمدير فرع تاني ميعدّيش فحص كل الفروع.
  const [employee] = await tx.execute<{ branch_ids: string[] }>(sql`SELECT
    ARRAY[e.primary_branch_id] || ARRAY(SELECT eb.branch_id FROM employee_branches eb
      WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND ${currentAttachment(days)}) AS branch_ids
    FROM employees e WHERE e.company_id=${context.companyId} AND e.business_id=${context.businessId}
      AND e.id=${context.employeeId} AND e.deleted_at IS NULL`);
  if (!employee) return null;
  const candidateBranchIds = [...new Set([...employee.branch_ids, ...branchContexts.map((branch) => branch.id)])];
  // بعد الحفظ تتقاس صلاحية الكتابة على الفرع المعدّل وحده، زي فحص الحفظ نفسه.
  const decision = await access.manage(tx, context.companyId, context.userId,
    context.businessId, managedBranchId ? [managedBranchId] : employee.branch_ids, candidateBranchIds);
  const managedBranchIds = decision.allowedBranchIds;
  let allowedBranchIds = managedBranchIds;
  if (managedBranchId) {
    if (!decision.manage) return null;
    if (!decision.featureEnabled) return 'FEATURE_DISABLED' as const;
  } else {
    const detail = await access.detail.checkMany(tx, context.companyId, context.userId,
      context.businessId, candidateBranchIds);
    if (!employee.branch_ids.every((branch) => detail.allowedBranchIds.includes(branch))) return null;
    if (!detail.featureEnabled) return 'FEATURE_DISABLED' as const;
    allowedBranchIds = detail.allowedBranchIds;
  }
  const rows = await tx.execute<{ branch_id: string } & Record<string, unknown>>(employeeDefaultShiftsStatement(context,
    branchContexts.filter((branch) => allowedBranchIds.includes(branch.id))));
  // صلاحية التعديل تتقاس على كل فرع لوحده، فالقارئ يقدر يعدّل فرع ويشوف التاني للقراءة بس.
  const branches = rows.map((row) => ({ ...row, can_manage: managedBranchIds.includes(row.branch_id) }));
  return view.parse({ employee_id: context.employeeId,
    can_manage: branches.some((branch) => branch.can_manage), branches });
}

async function branchDays(tx: Tx, branches: readonly { id: string; timezone: string }[]): Promise<BranchDay[]> {
  if (!branches.length) return [];
  return [...await tx.execute<{ branchId: string; today: string }>(sql`SELECT br.id AS "branchId",
    to_char((CURRENT_TIMESTAMP AT TIME ZONE br.timezone)::date,'YYYY-MM-DD') AS today
    FROM jsonb_to_recordset(${JSON.stringify(branches)}::jsonb) AS br(id uuid, timezone text)`)];
}
