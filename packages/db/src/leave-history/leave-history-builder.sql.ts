import { sql } from 'drizzle-orm';
import { currentAttachment } from '../employee-branch-links.ts';
import { historyEmployeeVisible, historyIds, type HistoryScope } from './leave-history-days.sql.ts';
import { historyRows } from './leave-history-rows.sql.ts';
import { historyLastTaken } from './leave-history-last.sql.ts';
import type {
  LeaveHistoryBuilderQuery,
  LeaveHistoryContext,
  LeaveHistoryCursor,
  LeaveHistoryReportOptions,
} from './types.ts';

function historySubject(
  c: LeaveHistoryContext,
  s: HistoryScope,
  report?: LeaveHistoryReportOptions,
) {
  if (report !== undefined) {
    if (c.employeeId === undefined) return sql`SELECT TRUE AS exists`;
    return sql`SELECT (EXISTS(SELECT 1 FROM employees subject
      WHERE company_id=${c.companyId} AND business_id=${c.businessId}
        AND id=${c.employeeId}::uuid AND deleted_at IS NULL
        AND ${historyEmployeeVisible(c, s, 'subject', report.attachment)})) AS exists`;
  }
  const eligibilityDays = s.eligibilityDays ?? [];
  const eligibilityBranches = eligibilityDays.map((day) => day.branchId);
  return sql`SELECT (EXISTS(SELECT 1 FROM employees
      WHERE company_id=${c.companyId} AND business_id=${c.businessId}
        AND id=${c.employeeId}::uuid AND deleted_at IS NULL)
      AND EXISTS(SELECT 1 FROM employee_branches eb
        WHERE eb.company_id=${c.companyId} AND eb.business_id=${c.businessId}
          AND eb.employee_id=${c.employeeId}::uuid
          AND eb.branch_id=ANY(${historyIds(eligibilityBranches)})
          AND ${currentAttachment(eligibilityDays)})) AS exists`;
}

export function leaveHistorySql(
  c: LeaveHistoryContext,
  q: LeaveHistoryBuilderQuery,
  s: HistoryScope,
  options: {
    asOf: string;
    excludeOpen: boolean;
    cursor?: LeaveHistoryCursor;
    report?: LeaveHistoryReportOptions;
  },
) {
  const { asOf, cursor, report } = options;
  const rows = historyRows(c, q, s, {
    ...options,
    ...(report === undefined ? {} : { visibility: report.attachment }),
  });
  const lastTaken =
    c.employeeId === undefined
      ? sql`NULL`
      : sql`CASE WHEN subject.exists THEN ${historyLastTaken(c, s, asOf)} END`;
  // صفحة السجل وآخر إجازة في snapshot واحدة حتى لا تختلف النتائج بسبب كتابة متزامنة.
  // علامة الموظف من نفس snapshot تمنع تسريب آخر إجازة لو اتحذف بعد فحص الصلاحية.
  // تبويب الملف يعيد فحص الربط الساري؛ التقرير يعيد فحص الوجود ورؤية الموظف المختارة.
  return sql`${rows}, subject AS (
    ${historySubject(c, s, report)}
  ), page AS (
    SELECT * FROM rows ${
      cursor === undefined
        ? sql``
        : sql`WHERE date<${cursor.date}::date
      OR (date=${cursor.date}::date AND rank>${cursor.rank})
      OR (date=${cursor.date}::date AND rank=${cursor.rank} AND id<${cursor.id}::uuid)`
    }
    ORDER BY date DESC,rank,id DESC LIMIT ${q.limit + 1}
  ) SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('date',date,'rank',rank,'id',id,'record',record)
    ORDER BY date DESC,rank,id DESC) FROM page),'[]'::jsonb) AS rows,
    subject.exists AS subject_exists,
    ${lastTaken} AS last_taken
    FROM subject`;
}
