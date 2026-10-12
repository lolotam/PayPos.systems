import { currentAttachment, type Tx } from '@pospay/db';
import {
  attendanceEmployeeCursor,
  attendanceEmployeePage,
  type AttendanceEmployeesQuery,
  type AttendanceEmployeePage,
} from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type { AttendanceBoardScope } from './attendance-board.query.ts';

export function attendanceEmployeesStatement(
  scope: AttendanceBoardScope,
  now: Date,
  query: AttendanceEmployeesQuery,
) {
  const cursor = query.cursor
    ? attendanceEmployeeCursor.parse(JSON.parse(query.cursor))
    : undefined;
  const date = query.date
    ? sql`${query.date}::date`
    : sql`(${now.toISOString()}::timestamptz AT TIME ZONE ${scope.timezone})::date`;
  // نطابق attendanceEligible في domain/clock-attendance.ts لئلا يرفض اليوم اليدوي اختياراً معروضاً: التعيين ونهاية العقد inclusive ونهاية ارتباط الفرع exclusive.
  const employment = sql`AND e.hire_date<=${date} AND (e.contract_end IS NULL OR e.contract_end>=${date})`;
  // منتقي «يوم يدوي» يبحث داخل ارتباطات الفرع المفهرسة فقط؛ MATERIALIZED يمنع تحويل البحث لمسح أسماء الشركة.
  return sql`WITH candidates AS MATERIALIZED (
    SELECT DISTINCT e.id,e.name_ar,e.name_en FROM employee_branches eb
    JOIN employees e ON e.company_id=eb.company_id AND e.business_id=eb.business_id AND e.id=eb.employee_id
    WHERE eb.company_id=${scope.companyId} AND eb.business_id=${scope.businessId}
      AND eb.branch_id=${scope.branchId} AND eb."from"<=${date}
      AND ${currentAttachment(date)} AND e.deleted_at IS NULL
      ${employment}
  ) SELECT id,name_ar,name_en FROM candidates
    WHERE TRUE
      ${query.search ? sql`AND (strpos(lower(name_en),lower(${query.search}))>0 OR strpos(lower(name_ar),lower(${query.search}))>0)` : sql``}
      ${cursor ? sql`AND (name_en,id)>(${cursor[0]},${cursor[1]}::uuid)` : sql``}
    ORDER BY name_en,id LIMIT ${query.limit + 1}`;
}

export async function attendanceEmployees(
  tx: Tx,
  scope: AttendanceBoardScope,
  now: Date,
  query: AttendanceEmployeesQuery,
): Promise<AttendanceEmployeePage> {
  const rows = await tx.execute<AttendanceEmployeePage['items'][number]>(
    attendanceEmployeesStatement(scope, now, query),
  );
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return attendanceEmployeePage.parse({
    items,
    next_cursor: rows.length > query.limit && last ? JSON.stringify([last.name_en, last.id]) : null,
  });
}
