import {
  attendanceChangeCursor,
  type AttendanceChangeListQuery,
  type AttendanceChangeRequestPage,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

export const ATTENDANCE_CHANGE_READ_ACCESS = Symbol('ATTENDANCE_CHANGE_READ_ACCESS');
export interface AttendanceChangeReadContext {
  companyId: string;
  businessId: string;
  userId: string;
}
export interface AttendanceChangeReadAccess {
  check(
    tx: Tx,
    context: AttendanceChangeReadContext,
  ): Promise<{
    owner: boolean;
    canDecide: boolean;
    decideBranches: string[];
    branches: string[];
  } | null>;
}
const uuidArray = (ids: readonly string[]) =>
  sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
export function attendanceChangePageStatement(
  context: AttendanceChangeReadContext,
  query: AttendanceChangeListQuery,
  access: { owner: boolean; canDecide: boolean; decideBranches: string[]; branches: string[] },
) {
  const cursor =
    query.cursor === undefined
      ? null
      : attendanceChangeCursor.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        );
  // صندوق حائز صلاحية القرار يعرض النشاط؛ زر القرار يراعي نطاق الفرع ومنع القرار الذاتي لغير المالك.
  return sql`SELECT jsonb_build_object('id',r.id,'business_id',r.business_id,'branch_id',r.branch_id,
    'kind',r.kind,'status',r.status,'employee',jsonb_build_object('id',e.id,'name_ar',e.name_ar,'name_en',e.name_en),
    'requested',CASE WHEN r.kind='ADD_SESSION' THEN jsonb_build_object(
        'clock_in',to_char(r.clock_in AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'clock_out',to_char(r.clock_out AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'working_date',r.working_date::text,'timezone',r.timezone) ELSE NULL END,
      'session_id',r.session_id,'session_revision',r.session_revision,'reason',r.reason,
    'requested_by',r.requested_by,'requested_at',to_char(r.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'decided_by',r.decided_by,'decided_at',to_char(r.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'decision_reason',r.decision_reason,'cancelled_by',r.cancelled_by,
    'cancelled_at',to_char(r.cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'revision',r.revision,'can_decide',${access.canDecide} AND r.branch_id=ANY(${uuidArray(access.decideBranches)})
      AND r.status='PENDING' AND (${access.owner} OR (r.requested_by<>${context.userId} AND e.user_id IS DISTINCT FROM ${context.userId})),
    'can_cancel',r.status='PENDING' AND r.requested_by=${context.userId}) AS record
    FROM attendance_change_requests r JOIN employees e ON e.company_id=r.company_id AND e.business_id=r.business_id AND e.id=r.employee_id
    WHERE r.company_id=${context.companyId} AND r.business_id=${context.businessId}
    ${access.canDecide ? sql`` : sql`AND r.branch_id=ANY(${uuidArray(access.branches)})`}
    ${query.status === undefined ? sql`` : sql`AND r.status=${query.status}`}
    ${query.branch_id === undefined ? sql`` : sql`AND r.branch_id=${query.branch_id}::uuid`}
    ${query.employee_id === undefined ? sql`` : sql`AND r.employee_id=${query.employee_id}::uuid`}
    ${query.kind === undefined ? sql`` : sql`AND r.kind=${query.kind}`}
    ${cursor === null ? sql`` : sql`AND (r.requested_at,r.id)<(${cursor.requested_at}::timestamptz,${cursor.id}::uuid)`}
    ORDER BY r.requested_at DESC,r.id DESC LIMIT ${query.limit + 1}`;
}
export async function listAttendanceChangeRequests(
  tx: Tx,
  context: AttendanceChangeReadContext,
  query: AttendanceChangeListQuery,
  reader: AttendanceChangeReadAccess,
): Promise<AttendanceChangeRequestPage | 'VALIDATION_FAILED' | null> {
  const access = await reader.check(tx, context);
  if (!access) return null;
  if (query.branch_id && !access.branches.includes(query.branch_id)) return null;
  let statement;
  try {
    statement = attendanceChangePageStatement(context, query, access);
  } catch {
    return 'VALIDATION_FAILED';
  }
  const rows = await tx.execute<{ record: AttendanceChangeRequestPage['items'][number] }>(
    statement,
  );
  const items = rows.slice(0, query.limit).map((r) => r.record);
  const last = items.at(-1);
  return {
    items,
    next_cursor:
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ requested_at: last.requested_at, id: last.id })).toString(
            'base64url',
          )
        : null,
  };
}
