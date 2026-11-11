import { sql } from 'drizzle-orm';
import type { LeaveHistoryQuery } from '@pospay/contracts';
import type { LeaveReadContext } from './leave-requests.query.ts';
import { historyIds, type HistoryScope } from './leave-history-days.sql.ts';
import { historyLeaveSource } from './leave-history-rows.sql.ts';

// تقرير سجل إجازات النشاط بيستخدم عد صفوف الورديات اللي days بيجمعها، عشان اليوم المقسوم ياخد وزن كل وردية والجدول الفاضي مايتحسبش.
// حد week_start بيخلي الفحص يبدأ من staff_schedules_branch_week_idx لأن working_date = week_start + يوم من 0–6.
export function historyWorkloadSql(
  c: LeaveReadContext,
  s: HistoryScope,
  q: { from: string; to: string },
  limit: number,
) {
  return sql`SELECT count(*)::int AS shifts FROM (
    SELECT 1 FROM staff_schedules sc
    JOIN staff_schedule_shifts sh ON sh.company_id=sc.company_id AND sh.schedule_id=sc.id
    WHERE sc.company_id=${c.companyId} AND sc.business_id=${c.businessId}
      AND sc.branch_id=ANY(${historyIds(s.attendanceBranches)})
      AND sc.week_start BETWEEN ${q.from}::date - 6 AND ${q.to}::date
      AND sh.company_id=${c.companyId}
      AND sh.working_date BETWEEN ${q.from}::date AND ${q.to}::date
    LIMIT ${limit + 1}
  ) w`;
}

// الفلاتر اللي بتتخطى days لسه بتقرا كل صفوف الإجازات المطابقة؛ العد بيحدها، وLIMIT بيحد الصفوف المتعدّاة مش نطاق الفهرس الممسوح.
export function historyLeaveWorkloadSql(
  c: LeaveReadContext,
  q: LeaveHistoryQuery,
  s: HistoryScope,
  options: { asOf: string; visibility?: 'current' | 'any' },
  limit: number,
) {
  const { asOf, visibility } = options;
  return sql`SELECT count(*)::int AS leaves FROM (
    SELECT 1 ${historyLeaveSource(c, q, s, { asOf, excludeOpen: false, visibility })}
    LIMIT ${limit + 1}
  ) w`;
}
