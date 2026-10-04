import type { Tx } from '@pospay/db';
import type { LeaveListQuery, LeavePage } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
export const LEAVE_READ_ACCESS = Symbol('LEAVE_READ_ACCESS');
export interface LeaveReadContext {
  companyId: string;
  userId: string;
  businessId: string;
  own: boolean;
  branchId?: string;
  employeeId?: string;
}
export interface LeaveReadAccess {
  check(
    tx: Tx,
    context: LeaveReadContext,
  ): Promise<{
    employeeId?: string;
    branches: string[];
    cancelBranches: string[];
    createBranches: string[];
    featureEnabled: boolean;
  } | null>;
}
const uuidArray = (ids: string[]) =>
  sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
export function leavePageSql(
  context: LeaveReadContext,
  query: LeaveListQuery,
  scope: { employeeId?: string; branches: string[]; cancelBranches: string[] },
  pending: boolean,
) {
  const employee = scope.employeeId ?? context.employeeId;
  // سجل الموظف وصندوق المدير يقرآن نفس الشكل، مع تصفية المجال قبل cursor والحد.
  return sql`SELECT jsonb_build_object('id',l.id,'business_id',l.business_id,'branch_id',l.branch_id,'employee_id',l.employee_id,
    'kind',l.kind,'from',l."from",'to',l."to",'start',l.start,'end',l."end",'timezone',l.timezone,
    'starts_at',to_char(l.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ends_at',to_char(l.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type',l.type,'note',l.note,'status',l.status,'requested_by',l.requested_by,
    'requested_at',to_char(l.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cancelled_by',l.cancelled_by,'cancelled_at',to_char(l.cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'decided_by',l.decided_by,'decided_at',to_char(l.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'rejection_reason',l.rejection_reason,'revision',l.revision,
    'can_cancel',l.status='PENDING' AND l.branch_id=ANY(${uuidArray(scope.cancelBranches)}) AND (${!context.own} OR l.requested_by=${context.userId})) AS record
    FROM leave_requests l WHERE l.company_id=${context.companyId} AND l.business_id=${context.businessId}
    AND l.branch_id=ANY(${uuidArray(scope.branches)}) ${employee === undefined ? sql`` : sql`AND l.employee_id=${employee}`}
    ${pending ? sql`AND l.status='PENDING'` : sql``}
    ${query.cursor === undefined ? sql`` : sql`AND l.id>${query.cursor}::uuid`}
    ORDER BY l.id LIMIT ${query.limit + 1}`;
}
async function page(
  tx: Tx,
  context: LeaveReadContext,
  query: LeaveListQuery,
  access: LeaveReadAccess,
  pending: boolean,
): Promise<LeavePage | 'FEATURE_DISABLED' | null> {
  const scope = await access.check(tx, context);
  if (!scope || scope.branches.length === 0) return null;
  if (!scope.featureEnabled) return 'FEATURE_DISABLED';
  const rows = await tx.execute<{ record: LeavePage['items'][number] }>(
    leavePageSql(context, query, scope, pending),
  );
  const items = rows.slice(0, query.limit).map((r) => r.record);
  return {
    items,
    next_cursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    request_branch_ids: scope.createBranches,
  };
}
export const employeeLeaveHistory = (
  tx: Tx,
  context: LeaveReadContext,
  query: LeaveListQuery,
  access: LeaveReadAccess,
) => page(tx, context, query, access, false);
export const pendingLeaveInbox = (
  tx: Tx,
  context: LeaveReadContext,
  query: LeaveListQuery,
  access: LeaveReadAccess,
) => page(tx, context, query, access, true);
