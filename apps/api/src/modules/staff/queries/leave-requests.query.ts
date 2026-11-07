import { leaveListRecord, uuidArray } from './leave-list-record.sql.ts';
import type { Tx } from '@pospay/db';
import type { EmployeeLeaveListQuery, LeaveInboxQuery, LeavePage } from '@pospay/contracts';
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
    attendanceBranches: string[];
    cancelBranches: string[];
    createBranches: string[];
    decideBranches: string[];
    revokeBranches: string[];
    now: Date;
    featureEnabled: boolean;
  } | null>;
}
export function leavePageSql(
  context: LeaveReadContext,
  query: LeaveInboxQuery & Pick<EmployeeLeaveListQuery, 'open' | 'as_of'>,
  scope: {
    employeeId?: string;
    branches: string[];
    cancelBranches: string[];
    decideBranches?: string[];
    revokeBranches?: string[];
    now?: Date;
    asOf?: string;
  },
  pending: boolean,
) {
  const employee = scope.employeeId ?? context.employeeId;
  // سجل الموظف وصندوق المدير يقرآن نفس الشكل، مع تصفية المجال قبل cursor والحد.
  return sql`SELECT ${leaveListRecord(context, scope)} AS record
    FROM leave_requests l JOIN employees subject ON subject.company_id=l.company_id AND subject.business_id=l.business_id AND subject.id=l.employee_id
    WHERE l.company_id=${context.companyId} AND l.business_id=${context.businessId}
    AND l.branch_id=ANY(${uuidArray(scope.branches)}) ${employee === undefined ? sql`` : sql`AND l.employee_id=${employee}`}
    AND EXISTS (SELECT 1 FROM employees e JOIN employee_branches eb
      ON eb.company_id=e.company_id AND eb.employee_id=e.id
      WHERE e.company_id=l.company_id AND e.business_id=l.business_id AND e.id=l.employee_id
      AND e.deleted_at IS NULL AND eb.branch_id=ANY(${uuidArray(scope.branches)}))
    ${pending ? sql`AND l.status='PENDING'` : sql``}
    ${query.branch_id === undefined ? sql`` : sql`AND l.branch_id=${query.branch_id}::uuid`}
    ${query.from === undefined ? sql`` : sql`AND l."to">=${query.from}::date`}
    ${query.to === undefined ? sql`` : sql`AND l."from"<=${query.to}::date`}
    ${query.cursor === undefined ? sql`` : sql`AND l.id>${query.cursor}::uuid`}${
      query.open === 'true'
        ? sql` AND (l."to">=(${scope.asOf}::timestamptz AT TIME ZONE l.timezone)::date OR l.status='PENDING')`
        : sql``
    }
    ORDER BY l.id LIMIT ${query.limit + 1}`;
}
async function page(
  tx: Tx,
  context: LeaveReadContext,
  query: LeaveInboxQuery & Pick<EmployeeLeaveListQuery, 'open' | 'as_of'>,
  access: LeaveReadAccess,
  pending: boolean,
): Promise<LeavePage | 'FEATURE_DISABLED' | 'VALIDATION_FAILED' | null> {
  const scope = await access.check(tx, context);
  if (!scope || scope.branches.length === 0) return null;
  if (!scope.featureEnabled) return 'FEATURE_DISABLED';
  const asOf = query.as_of === undefined ? scope.now : new Date(query.as_of);
  if (
    !Number.isFinite(asOf.getTime()) ||
    asOf.getTime() > scope.now.getTime() ||
    asOf.getTime() < scope.now.getTime() - 86_400_000
  )
    return 'VALIDATION_FAILED';
  const rows = await tx.execute<{ record: LeavePage['items'][number] }>(
    leavePageSql(context, query, { ...scope, asOf: asOf.toISOString() }, pending),
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
  query: EmployeeLeaveListQuery,
  access: LeaveReadAccess,
) =>
  // السجل مربوط بالموظف في كل فروع النشاط؛ branch_id في الجلسة الشخصية يختار الجلسة ولا يصفي القائمة.
  page(
    tx,
    context,
    {
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.open === undefined ? {} : { open: query.open }),
      ...(query.as_of === undefined ? {} : { as_of: query.as_of }),
    },
    access,
    false,
  );
export const pendingLeaveInbox = (
  tx: Tx,
  context: LeaveReadContext,
  query: LeaveInboxQuery,
  access: LeaveReadAccess,
) => page(tx, context, query, access, true);
