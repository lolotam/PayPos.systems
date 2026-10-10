import {
  appendAuditLog,
  appendOutboxEvent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { systemClock } from '../../../shared/adapters/system-clock.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import { PasskeyBindingError } from '../domain/passkey-binding.ts';
import type { PasskeyTransactions, PasskeyScope } from '../ports/passkeys.port.ts';
import { personalEmployee } from './personal-employee.ts';
import { attendanceDeviceLock } from './attendance-context.adapter.ts';
import { installationHash } from './attendance-device-signal.ts';
import { DeviceLockRefusal } from '../domain/passkey-device-lock.ts';

/** قفل الموظف يسلّسل التسجيل وإلغاء الربط اللاحق؛ unique index خط دفاع مستقل. */
export function createPasskeyTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  clock: Clock = systemClock,
): PasskeyTransactions {
  return {
    deviceLock: (scope, installationId) =>
      database.withTenant(
        scope.companyId,
        async (tx) => {
          if ((await personalEmployee(tx, scope.userId, scope, true, clock)) !== scope.employeeId)
            throw new PasskeyBindingError('FORBIDDEN');
          return attendanceDeviceLock(tx, scope, installationId, null);
        },
        { userId: scope.userId },
      ),
    run: async (scope, work) => {
      try {
        return await database.withTenant(
          scope.companyId,
          async (tx) => {
            if ((await personalEmployee(tx, scope.userId, scope, true, clock)) !== scope.employeeId)
              throw new PasskeyBindingError('FORBIDDEN');
            return work({
              deviceLock: (installationId) => attendanceDeviceLock(tx, scope, installationId, null),
              history: () => bindingHistory(tx, scope),
              insert: async (record) => {
                await tx.execute(sql`INSERT INTO employee_passkeys(company_id,id,business_id,employee_id,passkey_id,revision,bound_at,bound_by,installation_hash,installation_locked_at)
              VALUES(${scope.companyId},${record.id},${scope.businessId},${scope.employeeId},${record.passkeyId},${record.revision},${record.at.toISOString()},${scope.userId},${record.installationId === null ? null : installationHash(scope.companyId, record.installationId)},${record.installationId === null ? null : record.at.toISOString()})`);
                const payload = {
                  employee_id: scope.employeeId,
                  binding_id: record.id,
                  revision: record.revision,
                  bound_at: record.at.toISOString(),
                };
                await appendAuditLog(tx, ids.newId(), {
                  entity: 'employee_passkey',
                  entityId: record.id,
                  action: 'bound',
                  after: { ...payload, phone_locked: record.installationId !== null },
                });
                await appendOutboxEvent(tx, ids.newId(), {
                  aggregateType: 'employee',
                  aggregateId: scope.employeeId,
                  eventType: 'EmployeePasskeyBound',
                  payload,
                });
              },
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
  if (error instanceof PasskeyBindingError || error instanceof DeviceLockRefusal) throw error;
  // لا تتسرب مفاتيح أو معلمات SQL في التشخيص، حتى عند فشل FK أو COMMIT.
  throw new Error('PASSKEY_BINDING_PERSISTENCE_FAILED');
}

async function bindingHistory(tx: Tx, scope: PasskeyScope) {
  const [row] = await tx.execute<{ active: boolean; revision: number }>(sql`
    SELECT COALESCE(bool_or(unbound_at IS NULL),false) AS active,COALESCE(max(revision),0) AS revision
    FROM employee_passkeys WHERE company_id=${scope.companyId} AND employee_id=${scope.employeeId}`);
  return row ?? { active: false, revision: 0 };
}
