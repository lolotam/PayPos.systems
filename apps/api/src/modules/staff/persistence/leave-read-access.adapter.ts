import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { LeaveEmployee } from '../domain/leave-types.ts';
import { validateLeaveEmployee } from '../domain/leave-policy.ts';
import { scheduleToday } from '../domain/schedule-calendar.ts';
import type { LeaveClock } from '../ports/leave-transactions.port.ts';
export interface LeaveReadContext {
  companyId: string;
  userId: string;
  businessId: string;
  own: boolean;
  branchId?: string;
  employeeId?: string;
}
import { leaveAuthority, leaveBusinessContext } from './leave-context.adapter.ts';
async function readEmployee(tx: Tx, c: LeaveReadContext): Promise<LeaveEmployee | null> {
  const [row] = await tx.execute<{
    record: LeaveEmployee;
  }>(sql`SELECT jsonb_build_object('id',e.id,'user_id',e.user_id,'hire_date',e.hire_date,'contract_end',e.contract_end,'deleted_at',e.deleted_at,
    'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('branch_id',branch_id,'from',"from",'to',"to")) FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id),'[]'::jsonb)) AS record
    FROM employees e WHERE company_id=${c.companyId} AND business_id=${c.businessId} AND deleted_at IS NULL AND ${c.own ? sql`user_id=${c.userId}` : sql`id=${c.employeeId ?? null}::uuid`}
    ${c.own && c.employeeId !== undefined ? sql`AND id=${c.employeeId}::uuid` : sql``}`);
  return row?.record ?? null;
}
export function createLeaveReadAccess(clock: LeaveClock) {
  return {
    check: async (tx: Tx, c: LeaveReadContext) => {
      const business = await leaveBusinessContext(tx, c.companyId, c.businessId);
      if (!business) return null;
      const employee = c.own || c.employeeId !== undefined ? await readEmployee(tx, c) : null;
      if ((c.own || c.employeeId !== undefined) && !employee) return null;
      // سجل المدير يشمل الفروع المعطلة؛ إنشاء طلب فيها مستبعد من createBranches فقط.
      const branches = business.branches.filter(
        (b) => !c.own || (b.is_active && b.id === c.branchId),
      );
      const now = clock.now();
      const access = await leaveAuthority(
        tx,
        c.companyId,
        c.userId,
        c.businessId,
        branches.map((b) => b.id),
        now,
        c.own ? (employee?.user_id ?? '') : undefined,
      );
      if (
        employee &&
        (!employee.attachments.some((a) => access.read.includes(a.branch_id)) ||
          (c.own && employee.user_id !== c.userId))
      )
        return null;
      if (c.own && employee) {
        const branch = branches[0];
        if (!branch) return null;
        const today = scheduleToday(now, branch.effective_timezone);
        try {
          validateLeaveEmployee(employee, branch.id, { from: today, to: today });
        } catch {
          return null;
        }
      }
      return {
        ...(employee ? { employeeId: employee.id } : {}),
        // ملكية الموظف تقيد سجل الذات، بينما إذن القراءة مثبت في الفرع الحالي للجلسة.
        branches:
          c.own && access.read.length > 0 ? business.branches.map((b) => b.id) : [...access.read],
        cancelBranches:
          c.own && access.cancel.length > 0
            ? business.branches.map((b) => b.id)
            : [...access.cancel],
        createBranches: access.create.filter(
          (id) =>
            business.branches.some((b) => b.id === id && b.is_active) &&
            (employee?.attachments.some((a) => a.branch_id === id) ?? true),
        ),
        decideBranches: c.own ? [] : [...access.decide],
        revokeBranches: c.own ? [] : [...access.revoke],
        now,
        featureEnabled: access.featureEnabled,
      };
    },
  };
}
