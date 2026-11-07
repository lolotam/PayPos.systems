import { sql, type SQL } from 'drizzle-orm';
import type { LeaveReadContext } from './leave-requests.query.ts';

import { uuidArray as historyIds } from './leave-list-record.sql.ts';
export { uuidArray as historyIds } from './leave-list-record.sql.ts';
export type HistoryScope = {
  branches: string[];
  attendanceBranches: string[];
  cancelBranches: string[];
  decideBranches: string[];
  revokeBranches: string[];
  createBranches: string[];
  now: Date;
};
export function historyCoverage(c: LeaveReadContext, s: HistoryScope) {
  // سجل الإجازات يحتاج الحكم على كل حقيقة بمجالها، من غير كشف الحقيقة المخفية.
  return sql`SELECT
    EXISTS (SELECT 1 FROM leave_requests l WHERE l.company_id=${c.companyId}
      AND l.business_id=${c.businessId} AND l.employee_id=d.employee_id
      AND l.status IN ('APPROVED','PENDING') AND l."from"<=d.working_date AND l."to">=d.working_date) AS leave_any,
    EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.company_id=${c.companyId}
      AND a.business_id=${c.businessId} AND a.employee_id=d.employee_id
      AND a.working_date=d.working_date AND a.voided_at IS NULL) AS session_any,
    EXISTS (SELECT 1 FROM leave_requests l WHERE l.company_id=${c.companyId}
      AND l.business_id=${c.businessId} AND l.employee_id=d.employee_id
      AND l.status IN ('APPROVED','PENDING') AND l."from"<=d.working_date AND l."to">=d.working_date
      AND l.branch_id=ANY(${historyIds(s.branches)})) AS leave_visible,
    EXISTS (SELECT 1 FROM attendance_sessions a WHERE a.company_id=${c.companyId}
      AND a.business_id=${c.businessId} AND a.employee_id=d.employee_id
      AND a.working_date=d.working_date AND a.voided_at IS NULL
      AND a.branch_id=ANY(${historyIds(s.attendanceBranches)})) AS session_visible`;
}
export function historyDays(c: LeaveReadContext, s: HistoryScope, asOf: string, bound: SQL) {
  // التجميع يسبق أهلية اليوم حتى تفضل كل ورديات اليوم ومعرّفه ثابتين بين الورديات.
  return sql`SELECT d.*, coverage.* FROM (
    SELECT sh.employee_id, sc.branch_id, sh.working_date,
      (array_agg(sh.id ORDER BY sh.id))[1] AS id,
      jsonb_agg(jsonb_build_object('start',sh.start,'end',sh."end") ORDER BY sh.starts_at,sh.id) AS shifts,
      jsonb_agg(jsonb_build_object('id',sh.id,'start',sh.start,'end',sh."end") ORDER BY sh.id) AS own_shifts
    FROM staff_schedule_shifts sh JOIN staff_schedules sc
      ON sc.company_id=sh.company_id AND sc.id=sh.schedule_id
    JOIN employees e ON e.company_id=sh.company_id AND e.business_id=sc.business_id AND e.id=sh.employee_id
    WHERE sh.company_id=${c.companyId} AND sc.business_id=${c.businessId}
      AND sh.employee_id=${c.employeeId}::uuid AND e.deleted_at IS NULL
      AND sc.branch_id=ANY(${historyIds(s.attendanceBranches)})
      AND sh.working_date>=e.hire_date AND (e.contract_end IS NULL OR sh.working_date<=e.contract_end)
      ${bound}
    GROUP BY sh.employee_id,sc.branch_id,sh.working_date
    HAVING bool_or(sh.ends_at<=${asOf}::timestamptz)
  ) d CROSS JOIN LATERAL (${historyCoverage(c, s)}) coverage`;
}
