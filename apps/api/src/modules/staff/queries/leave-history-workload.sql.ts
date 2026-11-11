import { sql } from 'drizzle-orm';
import type { LeaveReadContext } from './leave-requests.query.ts';
import { historyIds, type HistoryScope } from './leave-history-days.sql.ts';

// تقرير سجل إجازات النشاط بيستخدم العد ده قبل SQL السجل عشان يرفض الشغل فوق الميزانية.
// الجدول موظف × فرع × أسبوع، وده مدخل days نفسه وبيحد مجموعات الأيام؛ week_start السبت والورديات عليه + 0–6.
export function historyWorkloadSql(
  c: LeaveReadContext,
  s: HistoryScope,
  q: { from: string; to: string },
  limit: number,
) {
  return sql`SELECT count(*)::int AS schedules FROM (
    SELECT 1 FROM staff_schedules
    WHERE company_id=${c.companyId} AND business_id=${c.businessId}
      AND branch_id=ANY(${historyIds(s.attendanceBranches)})
      AND week_start BETWEEN ${q.from}::date - 6 AND ${q.to}::date
    LIMIT ${limit + 1}
  ) w`;
}
