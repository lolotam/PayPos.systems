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
  PasskeyAccessClock,
  UnbindPasskeyTransactions,
} from '../ports/unbind-passkey.port.ts';
import { createManagerPasskeyAccess } from './manager-passkey-access.adapter.ts';

// نفس قاعدة شاشة القراءة: النهاية مستبعدة، المستقبلي محسوب، والفرع بلا يوم معروف محسوب.
function currentAttachment(days: readonly { branchId: string; today: string }[]) {
  const ids = sql`ARRAY[${sql.join(
    days.map((day) => sql`${day.branchId}::uuid`),
    sql`,`,
  )}]::uuid[]`;
  const dates = sql`ARRAY[${sql.join(
    days.map((day) => sql`${day.today}::date`),
    sql`,`,
  )}]::date[]`;
  return sql`(eb."to" IS NULL OR eb."to" > COALESCE((SELECT d.today FROM unnest(${ids},${dates}) AS d(branch_id,today) WHERE d.branch_id=eb.branch_id),'-infinity'::date))`;
}

async function authorize(tx: Tx, scope: ManagerPasskeyScope, clock: PasskeyAccessClock) {
  const { companyId, businessId, employeeId, userId } = scope;
  const access = createManagerPasskeyAccess(clock);
  if (!(await access.lock(tx, companyId))) throw new UnbindPasskeyError('NOT_FOUND');
  const days = await access.branchDays(tx, companyId, businessId);
  const [employee] = await tx.execute<{
    user_id: string | null;
    primary_branch_id: string;
    branch_ids: string[];
  }>(sql`
    SELECT user_id,primary_branch_id,
      ARRAY(SELECT branch_id FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.employee_id=e.id AND ${currentAttachment(days)} ORDER BY branch_id) AS branch_ids
    FROM employees e WHERE company_id=${companyId} AND business_id=${businessId} AND id=${employeeId} AND deleted_at IS NULL FOR UPDATE`);
  if (employee === undefined) throw new UnbindPasskeyError('NOT_FOUND');
  const branches = [...new Set([employee.primary_branch_id, ...employee.branch_ids])];
  const decision = await access.check(tx, companyId, userId, businessId, branches);
  if (!branches.every((id) => decision.unbindBranchIds.includes(id)))
    throw new UnbindPasskeyError('NOT_FOUND');
  if (!decision.featureEnabled) throw new UnbindPasskeyError('FEATURE_DISABLED');
  return { linkedToActor: employee.user_id === userId };
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
  clock: PasskeyAccessClock,
): UnbindPasskeyTransactions {
  return {
    run: async (scope, work) => {
      try {
        return await database.withTenant(
          scope.companyId,
          async (tx) => {
            const employee = await authorize(tx, scope, clock);
            const [binding] = await tx.execute<{
              id: string;
              revision: number;
              bound_by: string;
            }>(sql`SELECT id,revision,bound_by FROM employee_passkeys
          WHERE company_id=${scope.companyId} AND employee_id=${scope.employeeId} AND unbound_at IS NULL FOR UPDATE`);
            const active =
              binding === undefined ? null : { id: binding.id, revision: binding.revision };
            return work({
              // من سجّل الربط النشط يظل صاحبه حتى لو أعيد ربط الموظف بمستخدم آخر.
              ownBinding: employee.linkedToActor || binding?.bound_by === scope.userId,
              binding: active === null ? null : { ...active, unboundAt: null },
              save: (change) => save(tx, scope, ids, active, change),
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
