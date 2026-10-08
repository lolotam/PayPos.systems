import {
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { createHash } from 'node:crypto';
import {
  assertAttendanceExceptionDecider,
  assertAttendanceExceptionManual,
  AttendanceExceptionError,
  type AttendanceExceptionRecord,
} from '../domain/attendance-exception.ts';
import type {
  AttendanceExceptionActor,
  AttendanceExceptionClock,
  AttendanceExceptionTransactions,
} from '../ports/attendance-exception-transactions.port.ts';
import {
  attendanceExceptionAuthority,
  attendanceExceptionAuthorityLock,
} from './attendance-exception-context.adapter.ts';
import {
  lockedAttendanceException,
  lockedEmployeeUser,
} from './attendance-exception-records.ts';
import { saveAttendanceException } from './attendance-exception-writes.ts';

async function load(tx: Tx, actor: AttendanceExceptionActor, clock: AttendanceExceptionClock) {
  if (!(await attendanceExceptionAuthorityLock(tx, actor.companyId)))
    throw new AttendanceExceptionError('NOT_FOUND');
  const before = await lockedAttendanceException(tx, actor);
  const employeeUserId = await lockedEmployeeUser(tx, actor.companyId, before.employee_id);
  const now = clock.now();
  const allowed = await attendanceExceptionAuthority(
    tx,
    actor.companyId,
    actor.userId,
    actor.businessId,
    before.branch_id,
    now,
  );
  if (!allowed) throw new AttendanceExceptionError('NOT_FOUND');
  assertAttendanceExceptionDecider(employeeUserId, actor.userId);
  assertAttendanceExceptionManual(before.kind);
  return { before, employeeUserId, now };
}

function persistenceError(error: unknown): never {
  if (
    error instanceof AttendanceExceptionError ||
    error instanceof IdempotencyKeyBusyError ||
    error instanceof IdempotencyKeyReusedError
  )
    throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    ['40001', '40P01', '55P03'].includes(String(cause.code))
  )
    throw new AttendanceExceptionError('TRANSACTION_RETRY_REQUIRED');
  throw new Error('ATTENDANCE_EXCEPTION_PERSISTENCE_FAILED', { cause: error });
}

export function createAttendanceExceptionTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): AttendanceExceptionTransactions {
  return {
    run: async (actor, action, clock, work) => {
      try {
        return await database.withTenant(
          actor.companyId,
          async (tx) => {
            const context = await load(tx, actor, clock);
            const fingerprint = createHash('sha256')
              .update(
                JSON.stringify([
                  actor.userId,
                  actor.businessId,
                  actor.exceptionId,
                  action,
                  actor.fingerprint,
                ]),
              )
              .digest('hex');
            const result = await runIdempotent(
              tx,
              {
                scope: 'COMPANY',
                operation: `${action}-attendance-exception`,
                key: actor.key,
                fingerprint,
              },
              async () => {
                const body = await work({
                  ...context,
                  save: (change) =>
                    saveAttendanceException(
                      tx,
                      actor.companyId,
                      ids,
                      context.before,
                      change,
                      action,
                    ),
                });
                return { status: 200, body };
              },
            );
            return result.body as AttendanceExceptionRecord;
          },
          { userId: actor.userId },
        );
      } catch (error) {
        persistenceError(error);
      }
    },
  };
}
