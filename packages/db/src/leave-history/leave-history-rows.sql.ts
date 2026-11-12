import { sql } from 'drizzle-orm';
import type { LeaveHistoryBuilderQuery, LeaveHistoryContext } from './types.ts';
import {
  historyDays,
  historyEmployeeVisible,
  historyIds,
  type HistoryScope,
} from './leave-history-days.sql.ts';
import { historyLeaveRecord } from './leave-history-leaves.sql.ts';

const texts = (values: string[]) =>
  sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
function visibilityPredicate(
  c: LeaveHistoryContext,
  s: HistoryScope,
  alias: 'e' | 'subject',
  visibility?: 'current' | 'any',
) {
  // قاعدة رؤية الموظف مشتركة بين الأيام والإجازات حتى تتبعها أنواع الصفوف الثلاثة معاً.
  return visibility === undefined
    ? sql``
    : sql`AND ${historyEmployeeVisible(c, s, alias, visibility)}`;
}
// عد إجازات التقرير وصفوف الصفحة بيشتركوا في المصدر ده عشان الرفض يعد بالظبط اللي الصفحة بتقراه.
export function historyLeaveSource(
  c: LeaveHistoryContext,
  q: LeaveHistoryBuilderQuery,
  s: HistoryScope,
  options: { asOf: string; excludeOpen: boolean; visibility?: 'current' | 'any' | undefined },
) {
  const { asOf, excludeOpen, visibility } = options;
  const types = q['types[]'];
  const statuses = q['statuses[]'];
  return sql`FROM leave_requests l JOIN employees subject ON subject.company_id=l.company_id
      AND subject.business_id=l.business_id AND subject.id=l.employee_id
    WHERE l.company_id=${c.companyId} AND l.business_id=${c.businessId}
      ${c.employeeId === undefined ? sql`` : sql`AND l.employee_id=${c.employeeId}::uuid`}
      AND subject.deleted_at IS NULL ${visibilityPredicate(c, s, 'subject', visibility)}
      AND l.branch_id=ANY(${historyIds(s.branches)})
      AND l."from"<=${q.to}::date AND l."to">=${q.from}::date
      ${excludeOpen ? sql`AND NOT (l.status='PENDING' OR l."to">=(${asOf}::timestamptz AT TIME ZONE l.timezone)::date)` : sql``}
      ${types.length === 0 ? sql`` : sql`AND l.type=ANY(${texts(types)})`}
      ${statuses.length === 0 ? sql`` : sql`AND l.status=ANY(${texts(statuses)})`}
      ${q.branch_id === undefined ? sql`` : sql`AND l.branch_id=${q.branch_id}::uuid`}`;
}
export function historyRows(
  c: LeaveHistoryContext,
  q: LeaveHistoryBuilderQuery,
  s: HistoryScope,
  options: { asOf: string; excludeOpen: boolean; visibility?: 'current' | 'any' },
) {
  const { asOf, excludeOpen, visibility } = options;
  const types = q['types[]'];
  const statuses = q['statuses[]'];
  // السجل في ملف الموظف يستبعد الطلبات المفتوحة بنفس حد اليوم المحلي لقائمة الطلبات.
  return sql`WITH days AS (${historyDays(
    c,
    s,
    asOf,
    sql`
    AND sh.starts_at>=(( ${q.from}::date - 1)::timestamp AT TIME ZONE 'UTC')
    AND sh.starts_at<(( ${q.to}::date + 2)::timestamp AT TIME ZONE 'UTC')
    AND sh.working_date BETWEEN ${q.from}::date AND ${q.to}::date ${visibilityPredicate(c, s, 'e', visibility)}`,
  )}),
  rows AS (
    SELECT l."from" AS date,1 AS rank,l.id,${historyLeaveRecord(c, s)} AS record ${historyLeaveSource(c, q, s, { asOf, excludeOpen, visibility })}
    UNION ALL
    SELECT d.working_date,2,d.id,${dayRecord()} || jsonb_build_object(
      'row_type','UNEXCUSED_ABSENCE','id',d.id,'shifts',d.shifts,'status','ABSENT')
    FROM days d JOIN employees e ON e.company_id=${c.companyId} AND e.id=d.employee_id
    WHERE NOT d.leave_any AND NOT d.session_any
      AND ${types.length === 0 || types.includes('UNEXCUSED_ABSENCE')}
      AND ${statuses.length === 0 || statuses.includes('ABSENT')}
      ${q.branch_id === undefined ? sql`` : sql`AND d.branch_id=${q.branch_id}::uuid`}
    UNION ALL
    SELECT d.working_date,3,(sh.value->>'id')::uuid,${dayRecord()} || jsonb_build_object(
      'row_type','COVERED_ELSEWHERE','id',sh.value->>'id','shift',sh.value-'id')
    FROM days d JOIN employees e ON e.company_id=${c.companyId} AND e.id=d.employee_id
    CROSS JOIN LATERAL jsonb_array_elements(d.own_shifts) sh(value)
    WHERE (d.leave_any OR d.session_any) AND NOT d.leave_visible AND NOT d.session_visible
      AND ${types.length === 0 && statuses.length === 0}
      ${q.branch_id === undefined ? sql`` : sql`AND d.branch_id=${q.branch_id}::uuid`}
  )`;
}
function dayRecord() {
  return sql`jsonb_build_object('employee_id',e.id,'employee_name_en',e.name_en,
    'employee_name_ar',e.name_ar,'employee_number',e.employee_number,
    'working_date',d.working_date,'branch_id',d.branch_id)`;
}
