import { employeeDefaultShifts as view } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { EmployeeDetailAccess } from './employee-detail.query.ts';

export const EMPLOYEE_HOURS_READ_ACCESS = Symbol('EMPLOYEE_HOURS_READ_ACCESS');
export interface EmployeeHoursReadAccess {
  detail: EmployeeDetailAccess;
  /** يفحص إذن الإدارة الحي عند فروع الموظفة دون كشف بيانات الكتابة. */
  manage(tx: Tx, companyId: string, userId: string, businessId: string,
    branchIds: readonly string[]): Promise<{ manage: boolean; featureEnabled: boolean }>;
}
export interface EmployeeHoursReadContext {
  companyId: string; userId: string; businessId: string; employeeId: string;
}

// فروع الارتباط الحالية بتوقيت كل فرع، ومعها الفروع ذات الدوام المحفوظ حتى بعد فك الارتباط.
export function employeeDefaultShiftsStatement(context: EmployeeHoursReadContext) {
  const { companyId, businessId, employeeId } = context;
  return sql`SELECT b.id AS branch_id,
    EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=b.company_id
      AND eb.employee_id=${employeeId} AND eb.branch_id=b.id
      AND eb."from" <= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(b.timezone,bu.timezone))::date
      AND (eb."to" IS NULL OR eb."to" > (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(b.timezone,bu.timezone))::date)) AS linked,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('day',d.day,'start',left(d.start::text,5),
      'end',left(d."end"::text,5),'break_start',left(d.break_start::text,5),
      'break_end',left(d.break_end::text,5)) ORDER BY d.day)
      FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=b.id),'[]'::jsonb) AS shifts,
    (SELECT to_char(max(d.updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      FROM employee_default_shifts d WHERE d.company_id=${companyId} AND d.employee_id=${employeeId} AND d.branch_id=b.id) AS updated_at
    FROM branches b JOIN businesses bu ON bu.company_id=b.company_id AND bu.id=b.business_id
    WHERE b.company_id=${companyId} AND b.business_id=${businessId}
      AND (EXISTS(SELECT 1 FROM employee_default_shifts d WHERE d.company_id=b.company_id AND d.employee_id=${employeeId} AND d.branch_id=b.id)
        OR EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=b.company_id AND eb.employee_id=${employeeId} AND eb.branch_id=b.id
          AND eb."from" <= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(b.timezone,bu.timezone))::date
          AND (eb."to" IS NULL OR eb."to" > (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(b.timezone,bu.timezone))::date)))
    ORDER BY b.id`;
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
  const decision = await access.manage(tx, context.companyId, context.userId,
    context.businessId, employee.branch_ids);
  if (forManager) {
    if (!decision.manage) return null;
    if (!decision.featureEnabled) return 'FEATURE_DISABLED' as const;
  } else {
    const detail = await access.detail.checkMany(tx, context.companyId, context.userId,
      context.businessId, employee.branch_ids);
    if (!employee.branch_ids.every((branch) => detail.allowedBranchIds.includes(branch))) return null;
    if (!detail.featureEnabled) return 'FEATURE_DISABLED' as const;
  }
  const branches = await tx.execute(employeeDefaultShiftsStatement(context));
  return view.parse({ employee_id: context.employeeId, can_manage: decision.manage, branches });
}
