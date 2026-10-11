import { attendanceExceptionPage, type AttendanceExceptionsListQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { AttendanceBoardScope } from './attendance-board.query.ts';

const instant = (column: string) =>
  sql`to_char(${sql.raw(column)} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export function attendanceExceptionsStatement(
  scope: AttendanceBoardScope,
  query: AttendanceExceptionsListQuery,
) {
  const [raisedAt, cursorId] = query.cursor?.split('|') ?? [];
  // شاشة التحذيرات تعرض جلسات الفرع المسموح بقراءته، وتخفي تحذيرات الجلسات الملغاة دون تعديلها.
  return sql`SELECT jsonb_build_object('id',x.id,'branch_id',x.branch_id,'kind',x.kind,'status',x.status,
    'raised_at',${instant('x.raised_at')},'resolution',x.resolution,'resolved_by',x.resolved_by,
    'resolved_at',${instant('x.resolved_at')},'reason',x.reason,'revision',x.revision,
    'session',jsonb_build_object('id',s.id,'working_date',s.working_date::text,
      'clock_in',${instant('s.clock_in')},'clock_out',${instant('s.clock_out')},'status',s.status),
    'employee',jsonb_build_object('id',e.id,'name_ar',e.name_ar,'name_en',e.name_en)) AS record,
    to_char(x.raised_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    FROM attendance_exceptions x
    JOIN attendance_sessions s ON s.company_id=x.company_id AND s.id=x.session_id AND s.business_id=x.business_id
    JOIN employees e ON e.company_id=x.company_id AND e.id=x.employee_id AND e.business_id=x.business_id
    WHERE x.company_id=${scope.companyId} AND x.business_id=${scope.businessId}
      AND s.branch_id=${scope.branchId} AND x.status=${query.status} AND s.voided_at IS NULL
      ${raisedAt && cursorId ? sql`AND (x.raised_at,x.id)<(${raisedAt}::timestamptz,${cursorId}::uuid)` : sql``}
    ORDER BY x.raised_at DESC,x.id DESC LIMIT ${query.limit + 1}`;
}
export async function attendanceExceptions(
  tx: Tx,
  scope: AttendanceBoardScope,
  query: AttendanceExceptionsListQuery,
) {
  const rows = await tx.execute<{ record: unknown; cursor_at: string }>(
    attendanceExceptionsStatement(scope, query),
  );
  const page = attendanceExceptionPage.parse({
    items: rows.slice(0, query.limit).map((row) => row.record),
    next_cursor: null,
  });
  const last = page.items.at(-1);
  const lastRow = rows[query.limit - 1];
  if (rows.length > query.limit && last && lastRow)
    page.next_cursor = `${lastRow.cursor_at}|${last.id}`;
  return page;
}
