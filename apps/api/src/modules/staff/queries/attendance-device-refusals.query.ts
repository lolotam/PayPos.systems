import { attendanceDeviceRefusalPage, type AttendanceDeviceRefusalPage } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export interface AttendanceDeviceRefusalsQuery {
  companyId: string;
  businessId: string;
  branchId: string;
  from: Date;
  to: Date;
  limit: number;
  cursor?: { attemptedAt: string; id: string };
}
// لوحة الحضور في الصف ٢٧ تعرض المحاولات المرفوضة دون أي معرف تثبيت أو hash.
export function attendanceDeviceRefusalsStatement(query: AttendanceDeviceRefusalsQuery) {
  return sql`SELECT id,employee_id,holder_employee_id,branch_id,step,reason,
    to_char(attempted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS attempted_at
    FROM attendance_device_refusals WHERE company_id=${query.companyId} AND business_id=${query.businessId}
      AND branch_id=${query.branchId} AND attempted_at>=${query.from.toISOString()} AND attempted_at<${query.to.toISOString()}
      ${query.cursor === undefined ? sql`` : sql`AND (attempted_at,id)<(${query.cursor.attemptedAt}::timestamptz,${query.cursor.id}::uuid)`}
    ORDER BY attendance_device_refusals.attempted_at DESC,attendance_device_refusals.id DESC LIMIT ${query.limit + 1}`;
}
export async function attendanceDeviceRefusals(
  tx: Tx,
  query: AttendanceDeviceRefusalsQuery,
): Promise<AttendanceDeviceRefusalPage> {
  if (
    !Number.isInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 100 ||
    !Number.isFinite(query.from.getTime()) ||
    !Number.isFinite(query.to.getTime()) ||
    query.from >= query.to
  )
    throw new Error('INVALID_ATTENDANCE_DEVICE_REFUSALS_QUERY');
  const rows = await tx.execute<{ id: string; attempted_at: string }>(
    attendanceDeviceRefusalsStatement(query),
  );
  const items = rows.slice(0, query.limit);
  const last = items.at(-1);
  return attendanceDeviceRefusalPage.parse({
    items,
    next_cursor:
      rows.length > query.limit && last !== undefined ? `${last.attempted_at}|${last.id}` : null,
  });
}
