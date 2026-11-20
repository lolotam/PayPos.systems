import { leaveListRecord, uuidArray, type BranchDay, type Tx } from '@pospay/db';
import type {
  EmployeeLeaveListQuery,
  LeaveInboxQuery,
  LeavePage,
  OwnLeaveListQuery,
} from '@pospay/contracts';
import { sql } from 'drizzle-orm';
export const LEAVE_READ_ACCESS = Symbol('LEAVE_READ_ACCESS');
export interface LeaveReadContext {
  companyId: string;
  userId: string;
  businessId: string;
  own: boolean;
  branchId?: string;
  employeeId?: string;
  // غرض داخلي للسجل وحده؛ لا يظهر كمعامل في العقد ولا يغيّر سلوك القوائم والصندوق.
  purpose?: 'history';
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
    // يوم كل فرع في مجال القراءة؛ تقرأه الجملة الأخيرة للتحقق من أهلية ارتباط الموظف.
    eligibilityDays?: BranchDay[];
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
  order: 'oldest' | 'newest' = 'oldest',
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
    ${
      query.cursor === undefined
        ? sql``
        : order === 'newest'
          ? sql`AND l.id<${query.cursor}::uuid`
          : sql`AND l.id>${query.cursor}::uuid`
    }${
      query.open === 'true'
        ? sql` AND (l."to">=(${scope.asOf}::timestamptz AT TIME ZONE l.timezone)::date OR l.status='PENDING')`
        : sql``
    }
    ${order === 'newest' ? sql`ORDER BY l.id DESC` : sql`ORDER BY l.id`} LIMIT ${query.limit + 1}`;
}
// بند can_cancel بتاع صف القائمة في جملة واحدة؛ المسارات الذاتية تعيد استخدامه عشان الكارت والسجل ما يختلفوش.
export function ownLeaveCancelAuthoritySql(
  context: LeaveReadContext,
  leaveId: string,
  scope: { employeeId?: string; branches: string[]; cancelBranches: string[]; now?: Date },
) {
  const employee = scope.employeeId ?? context.employeeId;
  return sql`SELECT COALESCE((${leaveListRecord(context, scope)})->>'can_cancel','false')::boolean AS can_cancel
    FROM leave_requests l JOIN employees subject ON subject.company_id=l.company_id AND subject.business_id=l.business_id AND subject.id=l.employee_id
    WHERE l.company_id=${context.companyId} AND l.business_id=${context.businessId}
    AND l.id=${leaveId}::uuid AND l.employee_id=${employee}
    AND l.branch_id=ANY(${uuidArray(scope.branches)})
    AND EXISTS (SELECT 1 FROM employees e JOIN employee_branches eb
      ON eb.company_id=e.company_id AND eb.employee_id=e.id
      WHERE e.company_id=l.company_id AND e.business_id=l.business_id AND e.id=l.employee_id
      AND e.deleted_at IS NULL AND eb.branch_id=ANY(${uuidArray(scope.branches)}))`;
}
// كارت «آخر طلب» في «إجازاتي» بياخد زر الإلغاء منه بعد الكتابة مباشرة؛ الصلاحية قراءة حية لأنها لا تخزن مع الطلب.
export async function ownLeaveCancelAuthority(
  tx: Tx,
  context: LeaveReadContext,
  leaveId: string,
  access: LeaveReadAccess,
): Promise<boolean> {
  const scope = await access.check(tx, context);
  if (!scope || !scope.featureEnabled) return false;
  const rows = await tx.execute<{ can_cancel: boolean | null }>(
    ownLeaveCancelAuthoritySql(context, leaveId, scope),
  );
  return rows[0]?.can_cancel === true;
}
async function page(
  tx: Tx,
  context: LeaveReadContext,
  query: LeaveInboxQuery & Pick<EmployeeLeaveListQuery, 'open' | 'as_of'>,
  access: LeaveReadAccess,
  pending: boolean,
  order: 'oldest' | 'newest' = 'oldest',
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
    leavePageSql(context, query, { ...scope, asOf: asOf.toISOString() }, pending, order),
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
  // قائمة موظف واحد في لوحة الإدارة؛ ترتيبها تصاعدي بالـ id لأن عملاءها يعتمدون على الـ cursor ده (spec 068 TD-2).
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
// شاشة «إجازاتي» في apps/pos تقرأ هنا؛ الأحدث أولًا لأن الموظفة بتتابع آخر طلباتها، والـ id (UUID v7) يتبع وقت الإنشاء.
// السجل مربوط بالموظفة في كل فروع النشاط؛ branch_id في الجلسة الشخصية يختار الجلسة ولا يصفي القائمة.
export const ownLeaveHistory = (
  tx: Tx,
  context: LeaveReadContext,
  query: Pick<OwnLeaveListQuery, 'limit' | 'cursor'>,
  access: LeaveReadAccess,
) =>
  page(
    tx,
    context,
    { limit: query.limit, ...(query.cursor === undefined ? {} : { cursor: query.cursor }) },
    access,
    false,
    'newest',
  );
export const pendingLeaveInbox = (
  tx: Tx,
  context: LeaveReadContext,
  query: LeaveInboxQuery,
  access: LeaveReadAccess,
) => page(tx, context, query, access, true);
