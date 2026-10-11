import { employeeDefaultShifts as view } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { EmployeeDetailAccess } from './employee-detail.query.ts';

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
export function employeeDefaultShiftsStatement(context: EmployeeHoursReadContext,
  branches: readonly { id: string; timezone: string }[]) {
  const { companyId, employeeId } = context;
  const payload = JSON.stringify(branches);
  return sql`SELECT br.id AS branch_id,
    EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=${companyId}
      AND eb.employee_id=${employeeId} AND eb.branch_id=br.id
      AND eb."from" <= (CURRENT_TIMESTAMP AT TIME ZONE br.timezone)::date
      AND (eb."to" IS NULL OR eb."to" > (CURRENT_TIMESTAMP AT TIME ZONE br.timezone)::date)) AS linked,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('day',d.day,'start',left(d.start::text,5),
      'end',left(d."end"::text,5),'break_start',left(d.break_start::text,5),
      'break_end',left(d.break_end::text,5)) ORDER BY d.day)
      FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=br.id),'[]'::jsonb) AS shifts,
    (SELECT to_char(max(d.updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=br.id) AS updated_at
    FROM jsonb_to_recordset(${payload}::jsonb) AS br(id uuid, timezone text)
    WHERE (EXISTS(SELECT 1 FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=br.id)
        OR EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=${companyId} AND eb.employee_id=${employeeId} AND eb.branch_id=br.id
          AND eb."from" <= (CURRENT_TIMESTAMP AT TIME ZONE br.timezone)::date
          AND (eb."to" IS NULL OR eb."to" > (CURRENT_TIMESTAMP AT TIME ZONE br.timezone)::date)))
    ORDER BY br.id`;
}

export async function employeeDefaultShifts(tx: Tx, context: EmployeeHoursReadContext,
  access: EmployeeHoursReadAccess, forManager = false) {
  // يعاد فحص فروع السجل داخل معاملة القراءة قبل عرض الدوام وحالة الميزة.
  const [employee] = await tx.execute<{ branch_ids: string[] }>(sql`SELECT
    ARRAY[e.primary_branch_id] || ARRAY(SELECT eb.branch_id FROM employee_branches eb
      WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb."to" IS NULL) AS branch_ids
    FROM employees e WHERE e.company_id=${context.companyId} AND e.business_id=${context.businessId}
      AND e.id=${context.employeeId} AND e.deleted_at IS NULL`);
  if (!employee) return null;
  const branchContexts = await access.branches(tx, context.companyId, context.businessId);
  const candidateBranchIds = [...new Set([...employee.branch_ids, ...branchContexts.map((branch) => branch.id)])];
  const decision = await access.manage(tx, context.companyId, context.userId,
    context.businessId, employee.branch_ids, candidateBranchIds);
  let allowedBranchIds = decision.allowedBranchIds;
  if (forManager) {
    if (!decision.manage) return null;
    if (!decision.featureEnabled) return 'FEATURE_DISABLED' as const;
  } else {
    const detail = await access.detail.checkMany(tx, context.companyId, context.userId,
      context.businessId, candidateBranchIds);
    if (!employee.branch_ids.every((branch) => detail.allowedBranchIds.includes(branch))) return null;
    if (!detail.featureEnabled) return 'FEATURE_DISABLED' as const;
    allowedBranchIds = detail.allowedBranchIds;
  }
  const branches = await tx.execute(employeeDefaultShiftsStatement(context,
    branchContexts.filter((branch) => allowedBranchIds.includes(branch.id))));
  return view.parse({ employee_id: context.employeeId, can_manage: decision.manage, branches });
}
