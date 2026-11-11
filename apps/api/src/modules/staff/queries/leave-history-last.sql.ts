import { sql } from 'drizzle-orm';
import type { LeaveReadContext } from './leave-requests.query.ts';
import { historyIds, type HistoryScope } from './leave-history-days.sql.ts';
import { historyLatestAbsence } from './leave-history-last-absence.sql.ts';

export function historyLastTaken(c: LeaveReadContext, s: HistoryScope, asOf: string) {
  // سطر آخر الإجازات في ملف الموظف مستقل عن فترة الصفحات.
  const leave = (type: string) => sql`(SELECT jsonb_build_object('from',l."from",'to',l."to")
    FROM leave_requests l WHERE l.company_id=${c.companyId} AND l.business_id=${c.businessId}
      AND l.employee_id=${c.employeeId}::uuid AND l.branch_id=ANY(${historyIds(s.branches)})
      AND l.type=${type} AND l.status='APPROVED'
      AND l."from"<=(${asOf}::timestamptz AT TIME ZONE l.timezone)::date
    ORDER BY l."from" DESC,l.id DESC LIMIT 1)`;
  // آخر غياب على كل التاريخ؛ ترتيب starts_at لا يمثل ترتيب working_date بين المناطق الزمنية.
  return sql`jsonb_build_object('annual',${leave('ANNUAL')},'sick',${leave('SICK')},'unpaid',${leave('UNPAID')})
    ${
      s.attendanceBranches.length === 0
        ? sql``
        : sql`|| jsonb_build_object('unexcused_absence',
       ${historyLatestAbsence(c, s, asOf)})`
    }`;
}
