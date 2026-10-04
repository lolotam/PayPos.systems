import {
  appendAuditLog,
  appendOutboxEvent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { UnbindPasskeyError } from '../domain/unbind-passkey.ts';
import type {
  ManagerPasskeyScope,
  UnbindPasskeyTransactions,
} from '../ports/unbind-passkey.port.ts';
import { createManagerPasskeyAccess } from './manager-passkey-access.adapter.ts';

async function authorize(tx: Tx, scope: ManagerPasskeyScope) {
  const { companyId, businessId, employeeId, userId } = scope;
  const access = createManagerPasskeyAccess();
  if (!(await access.lock(tx, companyId))) throw new UnbindPasskeyError('NOT_FOUND');
  const [employee] = await tx.execute<{
    user_id: string | null;
    primary_branch_id: string;
    branch_ids: string[];
  }>(sql`
    SELECT user_id,primary_branch_id,
      ARRAY(SELECT branch_id FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND eb."to" IS NULL ORDER BY branch_id) AS branch_ids
    FROM employees e WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL FOR UPDATE`);
  if (employee === undefined) throw new UnbindPasskeyError('NOT_FOUND');
  const branches = [...new Set([employee.primary_branch_id, ...employee.branch_ids])];
  const decision = await access.check(tx, companyId, userId, businessId, branches);
  if (!branches.every((id) => decision.unbindBranchIds.includes(id)))
    throw new UnbindPasskeyError('NOT_FOUND');
  if (!decision.featureEnabled) throw new UnbindPasskeyError('FEATURE_DISABLED');
  return { ownBinding: employee.user_id === userId };
}

async function save(
  tx: Tx,
  scope: ManagerPasskeyScope,
  ids: IdGenerator,
  binding: { id: string; revision: number } | null,
  change: { revision: number; reason: string; at: Date },
) {
  if (binding === null) throw new UnbindPasskeyError('PASSKEY_REVISION_CONFLICT');
  const result =
    await tx.execute(sql`UPDATE employee_passkeys SET revision=${change.revision},unbound_at=${change.at.toISOString()},unbound_by=${scope.userId}
    WHERE company_id=${scope.companyId} AND employee_id=${scope.employeeId} AND id=${binding.id} AND revision=${binding.revision} AND unbound_at IS NULL RETURNING id`);
  if (result.length !== 1) throw new UnbindPasskeyError('PASSKEY_REVISION_CONFLICT');
  const payload = {
    employee_id: scope.employeeId,
    binding_id: binding.id,
    revision: change.revision,
    unbound_at: change.at.toISOString(),
  };
  await appendAuditLog(tx, ids.newId(), {
    entity: 'employee_passkey',
    entityId: binding.id,
    action: 'passkey.unbind',
    before: { employee_id: scope.employeeId, binding_id: binding.id, revision: binding.revision },
    after: { ...payload, reason: change.reason },
  });
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'employee',
    aggregateId: scope.employeeId,
    eventType: 'EmployeePasskeyUnbound',
    payload,
  });
}

/** الشركة والعضويات والموظف ثم الربط؛ ترتيب التسجيل نفسه يمنع سباق التبديل والتعطيل. */
export function createUnbindPasskeyTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): UnbindPasskeyTransactions {
  return {
    run: async (scope, work) => {
      try {
        return await database.withTenant(
          scope.companyId,
          async (tx) => {
            const employee = await authorize(tx, scope);
            const [binding] = await tx.execute<{
              id: string;
              revision: number;
            }>(sql`SELECT id,revision FROM employee_passkeys
          WHERE company_id=${scope.companyId} AND employee_id=${scope.employeeId} AND unbound_at IS NULL FOR UPDATE`);
            return work({
              ...employee,
              binding: binding === undefined ? null : { ...binding, unboundAt: null },
              save: (change) => save(tx, scope, ids, binding ?? null, change),
            });
          },
          { userId: scope.userId },
        );
      } catch (error) {
        cleanFailure(error);
      }
    },
  };
}

function cleanFailure(error: unknown): never {
  if (error instanceof UnbindPasskeyError) throw error;
  // أخطاء SQL قد تحمل معلمات؛ نحافظ على تشخيص آمن دون سبب حر أو هوية اعتماد.
  throw new Error('PASSKEY_UNBIND_PERSISTENCE_FAILED');
}
