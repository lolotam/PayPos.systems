import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { EmployeeCreationError } from '../domain/create-employee.ts';
import type { EditableEmployee, EmployeeUpdatePlan } from '../domain/update-employee.ts';
import type {
  EmployeeUpdateScope,
  EmployeeUpdateTransactions,
} from '../ports/employee-update-transactions.port.ts';
import type { StaffAccessGrantCache } from '../ports/staff-access-user-steps.port.ts';
import {
  authorizeEmployeeCreation,
  canLinkEmployeeUser,
  employeeBranchAccess,
  employeeContext,
} from './employee-context.adapter.ts';
import { canManageStaffAccess } from './employee-access-reads.adapter.ts';
import { followPrimaryBranch } from './employee-access-branch-follow.ts';
import { lockedEmployee } from './employee-update-record.ts';

async function loadEmployee(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  employeeId: string,
) {
  const [scope] = await tx.execute<{ primary_branch_id: string }>(
    sql`SELECT primary_branch_id FROM employees WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL`,
  );
  if (
    scope === undefined ||
    // يأخذ قفل الشركة FOR NO KEY UPDATE ثم العضويات FOR UPDATE قبل قفل الموظفة وسجل الدخول.
    !(await authorizeEmployeeCreation(tx, companyId, userId, businessId, scope.primary_branch_id))
  )
    return null;
  const current = await lockedEmployee(tx, companyId, businessId, employeeId);
  if (current === null) return null;
  const decision = await employeeBranchAccess(tx, companyId, userId, businessId, [
    ...current.record.branch_ids,
    current.record.primary_branch_id,
  ]);
  if (
    ![...current.record.branch_ids, current.record.primary_branch_id].every((id) =>
      decision.allowedBranchIds.includes(id),
    )
  )
    return null;
  return current;
}

/** سجل التدقيق ما يحملش الإيميل: بيانات شخصية، فبيتسجل «موجود» أو «اتغيّر» أو null بس. */
function auditSafe(record: EditableEmployee, previousEmail?: string | null) {
  const recoveryEmail =
    record.recovery_email === null
      ? null
      : previousEmail !== undefined &&
          previousEmail !== null &&
          previousEmail !== record.recovery_email
        ? 'CHANGED'
        : 'SET';
  return { ...record, recovery_email: recoveryEmail };
}

/** تغيير إيميل الاستعادة مقيّد بصلاحية إدارة دخول الموظفين وممنوع على صاحبة الدخول لنفسها (GR-001). */
async function assertRecoveryEmailAuthority(
  tx: Tx,
  input: {
    readonly companyId: string;
    readonly userId: string;
    readonly before: EditableEmployee;
    readonly after: EditableEmployee;
  },
): Promise<void> {
  const { companyId, userId, before, after } = input;
  if (after.recovery_email === before.recovery_email) return;
  if (before.user_id === userId || after.user_id === userId) {
    const accessRows = await tx.execute(
      sql`SELECT 1 FROM employee_staff_access WHERE company_id=${companyId} AND employee_id=${after.id} LIMIT 1 FOR SHARE`,
    );
    if (accessRows.length !== 0) throw new EmployeeCreationError('FORBIDDEN');
  }
  for (const branchId of new Set([before.primary_branch_id, after.primary_branch_id])) {
    if (
      !(await canManageStaffAccess(tx, {
        companyId,
        actorUserId: userId,
        businessId: after.business_id,
        branchId,
      }))
    )
      throw new EmployeeCreationError('FORBIDDEN');
  }
}

async function saveEmployee(
  tx: Tx,
  companyId: string,
  userId: string,
  ids: IdGenerator,
  before: EditableEmployee,
  plan: EmployeeUpdatePlan,
  date: string,
  attachments: readonly { id: string; branchId: string }[],
): Promise<Move | null> {
  const r = plan.after;
  await assertRecoveryEmailAuthority(tx, { companyId, userId, before, after: r });
  const changed =
    await tx.execute(sql`UPDATE employees SET primary_branch_id=${r.primary_branch_id},name_en=${r.name_en},name_ar=${r.name_ar},name_en_key=${plan.name_en_key},name_ar_key=${plan.name_ar_key},role_code=${r.role_code},hire_date=${r.hire_date},contract_end=${r.contract_end},user_id=${r.user_id},recovery_email=${r.recovery_email},revision=${r.revision}
    WHERE company_id=${companyId} AND business_id=${r.business_id} AND id=${r.id} AND revision=${before.revision} AND deleted_at IS NULL RETURNING id`);
  if (changed.length !== 1) throw new EmployeeCreationError('EMPLOYEE_REVISION_CONFLICT');
  for (const attachmentId of plan.detach)
    await tx.execute(
      sql`UPDATE employee_branches SET "to"=${date} WHERE company_id=${companyId} AND employee_id=${r.id} AND id=${attachmentId} AND "to" IS NULL`,
    );
  for (const attachment of attachments)
    await tx.execute(
      sql`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES (${companyId},${attachment.id},${r.business_id},${r.id},${attachment.branchId},${date})`,
    );
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employee',
    entityId: r.id,
    action: 'updated',
    before: auditSafe(before),
    after:
      plan.attach.length > 0 || plan.detach.length > 0
        ? {
            ...auditSafe(r, before.recovery_email),
            branch_change: {
              effective_date: date,
              attached: attachments,
              closed_attachment_ids: plan.detach,
            },
          }
        : auditSafe(r, before.recovery_email),
  });
  if (r.primary_branch_id === before.primary_branch_id) return null;
  return followPrimaryBranch(tx, {
    companyId,
    employeeId: r.id,
    branchId: r.primary_branch_id,
    ids,
  });
}

function updateError(error: unknown): never {
  if (error instanceof EmployeeCreationError) throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'constraint_name' in cause) {
    if (
      ['employee_branches_no_overlap', 'employee_branches_active_key'].includes(
        String(cause.constraint_name),
      )
    )
      throw new EmployeeCreationError('EMPLOYEE_BRANCH_HISTORY_OVERLAP');
    if (cause.constraint_name === 'employee_branches_close_once')
      throw new EmployeeCreationError('EMPLOYEE_BRANCH_HISTORY_IMMUTABLE');
    if (cause.constraint_name === 'employee_branches_nonempty_interval')
      throw new EmployeeCreationError('EMPLOYEE_BRANCH_DATE_BEFORE_START');
    if (cause.constraint_name === 'employees_active_user_business_key')
      throw new EmployeeCreationError('EMPLOYEE_USER_ALREADY_LINKED');
    if (cause.constraint_name === 'employees_company_recovery_email_uidx')
      throw new EmployeeCreationError('EMPLOYEE_RECOVERY_EMAIL_TAKEN');
    if (cause.constraint_name === 'employees_user_id_user_id_fk')
      throw new EmployeeCreationError('EMPLOYEE_USER_LINK_UNAVAILABLE');
  }
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    ['40001', '40P01'].includes(String(cause.code))
  )
    throw new EmployeeCreationError('TRANSACTION_RETRY_REQUIRED');
  throw new Error('EMPLOYEE_PERSISTENCE_FAILED');
}

/** إبطال كاش المنح بعد الالتزام: الافتراضي لا يفعل شيئاً فلا تتغير اختبارات تبني المنفذ بدون Redis. */
const NO_INVALIDATION: StaffAccessGrantCache = { invalidate: async () => undefined };

type Move = { oldMembershipId: string; newMembershipId: string };

function updateScope(
  tx: Tx,
  actor: { companyId: string; userId: string },
  ids: IdGenerator,
  moved: Move[],
): EmployeeUpdateScope {
  const { companyId, userId } = actor;
  return {
    load: (businessId, employeeId) => loadEmployee(tx, companyId, userId, businessId, employeeId),
    authorize: async (businessId, branchIds) => {
      const decision = await employeeBranchAccess(tx, companyId, userId, businessId, branchIds);
      if (decision.allowedBranchIds.length === new Set(branchIds).size && !decision.featureEnabled)
        throw new EmployeeCreationError('FEATURE_DISABLED');
      return branchIds.every((id) => decision.allowedBranchIds.includes(id));
    },
    contexts: (record, branchIds) =>
      Promise.all(
        branchIds.map((branchId) =>
          employeeContext(tx, companyId, { ...record, primary_branch_id: branchId }),
        ),
      ),
    canLinkUser: (linkedUserId) => canLinkEmployeeUser(tx, companyId, linkedUserId),
    hasAccessRecord: async (employeeId) => {
      const rows = await tx.execute(sql`SELECT 1 FROM employee_staff_access
        WHERE company_id=${companyId} AND employee_id=${employeeId} LIMIT 1 FOR UPDATE`);
      return rows.length !== 0;
    },
    // القفل على السجل هنا بيحافظ على ترتيب الأقفال: شركة ← عضويات ← موظفة ← سجل دخول.
    hasPendingAccessRecord: async (employeeId) => {
      const rows = await tx.execute(sql`SELECT 1 FROM employee_staff_access
        WHERE company_id=${companyId} AND employee_id=${employeeId}
          AND state IN ('PENDING', 'CANCELLING', 'PHONE_CHANGING') LIMIT 1 FOR UPDATE`);
      return rows.length !== 0;
    },
    save: async (before, plan, date, attachments) => {
      const move = await saveEmployee(tx, companyId, userId, ids, before, plan, date, attachments);
      if (move !== null) moved.push(move);
    },
  };
}

export function createEmployeeUpdateTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  grantCache: StaffAccessGrantCache = NO_INVALIDATION,
): EmployeeUpdateTransactions {
  return {
    run: async (actor, work) => {
      const moved: Move[] = [];
      try {
        const result = await database.withTenant(
          actor.companyId,
          (tx) => work(updateScope(tx, actor, ids, moved)),
          { userId: actor.userId },
        );
        // الإبطال بعد الالتزام best-effort: فشل الكاش لا يحوّل تعديلاً التزم إلى خطأ، والمنح تنتهي بمهلتها.
        for (const move of moved)
          for (const membershipId of [move.oldMembershipId, move.newMembershipId])
            await grantCache
              .invalidate({ companyId: actor.companyId, membershipId })
              .catch(() => undefined);
        return result;
      } catch (error) {
        updateError(error);
      }
    },
  };
}
