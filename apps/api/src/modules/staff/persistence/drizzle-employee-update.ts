import { appendAuditLog, type IdGenerator, type TenantWrappers, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { EmployeeCreationError } from '../domain/create-employee.ts';
import type { EditableEmployee, EmployeeUpdatePlan } from '../domain/update-employee.ts';
import type { EmployeeUpdateTransactions } from '../ports/employee-update-transactions.port.ts';
import {
  authorizeEmployeeCreation,
  canLinkEmployeeUser,
  employeeBranchAccess,
  employeeContext,
} from './employee-context.adapter.ts';
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
  if (!decision.featureEnabled) throw new EmployeeCreationError('FEATURE_DISABLED');
  return current;
}

async function saveEmployee(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  before: EditableEmployee,
  plan: EmployeeUpdatePlan,
  date: string,
  attachments: readonly { id: string; branchId: string }[],
) {
  const r = plan.after;
  const changed =
    await tx.execute(sql`UPDATE employees SET primary_branch_id=${r.primary_branch_id},name_en=${r.name_en},name_ar=${r.name_ar},role_code=${r.role_code},hire_date=${r.hire_date},contract_end=${r.contract_end},user_id=${r.user_id},revision=${r.revision}
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
    before,
    after:
      plan.attach.length > 0 || plan.detach.length > 0
        ? {
            ...r,
            branch_change: {
              effective_date: date,
              attached: attachments,
              closed_attachment_ids: plan.detach,
            },
          }
        : r,
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

export function createEmployeeUpdateTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): EmployeeUpdateTransactions {
  return {
    run: async ({ companyId, userId }, work) => {
      try {
        return await database.withTenant(
          companyId,
          (tx) =>
            work({
              load: (businessId, employeeId) =>
                loadEmployee(tx, companyId, userId, businessId, employeeId),
              authorize: async (businessId, branchIds) => {
                const decision = await employeeBranchAccess(
                  tx,
                  companyId,
                  userId,
                  businessId,
                  branchIds,
                );
                if (
                  decision.allowedBranchIds.length === new Set(branchIds).size &&
                  !decision.featureEnabled
                )
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
              save: (before, plan, date, attachments) =>
                saveEmployee(tx, companyId, ids, before, plan, date, attachments),
            }),
          { userId },
        );
      } catch (error) {
        updateError(error);
      }
    },
  };
}
