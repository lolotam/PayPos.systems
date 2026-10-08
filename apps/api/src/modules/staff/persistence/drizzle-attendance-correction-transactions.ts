import {
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { createHash } from 'node:crypto';
import { AttendanceCorrectionError } from '../domain/attendance-correction.ts';
import type {
  AttendanceCorrectionActor,
  AttendanceCorrectionClock,
  AttendanceCorrectionResult,
  AttendanceCorrectionScope,
  AttendanceCorrectionTransactions,
} from '../ports/attendance-correction-transactions.port.ts';
import {
  attendanceCorrectionAuthority,
  attendanceCorrectionAuthorityLock,
} from './attendance-correction-context.adapter.ts';
import {
  lockCorrectionState,
  lockedCorrectionEmployeeUser,
  lockedCorrectionNeighbours,
  lockedCorrectionSession,
  peekCorrectionSession,
} from './attendance-correction-records.ts';
import { saveAttendanceCorrection } from './attendance-correction-writes.ts';

async function load(tx: Tx, actor: AttendanceCorrectionActor, clock: AttendanceCorrectionClock) {
  const candidate = await peekCorrectionSession(tx, actor);
  // رفض الفرع غير المسموح قبل أي قفل يمنع كشف وجود الجلسة بمهلة انتظار القفل.
  const precheck = await attendanceCorrectionAuthority(
    tx,
    actor.companyId,
    actor.userId,
    actor.businessId,
    candidate.branch_id,
    clock.now(),
  );
  if (!precheck.allowed) throw new AttendanceCorrectionError('NOT_FOUND');
  // قفل الحالة قبل الجلسة (ADR-0028) حتى يتسلسل التصحيح مع المسح ومهمة الخروج الفائت.
  const employeeId = candidate.employee_id;
  await lockCorrectionState(tx, actor.companyId, employeeId);
  if (!(await attendanceCorrectionAuthorityLock(tx, actor.companyId)))
    throw new AttendanceCorrectionError('NOT_FOUND');
  const session = await lockedCorrectionSession(tx, actor);
  if (session.employee_id !== employeeId) throw new AttendanceCorrectionError('NOT_FOUND');
  const employeeUserId = await lockedCorrectionEmployeeUser(tx, actor.companyId, session.employee_id);
  const neighbours = await lockedCorrectionNeighbours(
    tx,
    actor.companyId,
    session.employee_id,
    session.id,
  );
  const now = clock.now();
  const access = await attendanceCorrectionAuthority(
    tx,
    actor.companyId,
    actor.userId,
    actor.businessId,
    session.branch_id,
    now,
  );
  if (!access.allowed) throw new AttendanceCorrectionError('NOT_FOUND');
  return { session, employeeUserId, neighbours, now, owner: access.owner };
}

function persistenceError(error: unknown): never {
  if (
    error instanceof AttendanceCorrectionError ||
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
    throw new AttendanceCorrectionError('TRANSACTION_RETRY_REQUIRED');
  throw new Error('ATTENDANCE_CORRECTION_PERSISTENCE_FAILED', { cause: error });
}

function fingerprintFor(actor: AttendanceCorrectionActor): string {
  return createHash('sha256')
    .update(JSON.stringify([actor.userId, actor.businessId, actor.sessionId, actor.fingerprint]))
    .digest('hex');
}

export function createAttendanceCorrectionTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): AttendanceCorrectionTransactions {
  return {
    run: (actor, clock, work) => correctOnce(database, ids, actor, clock, work),
  };
}

async function correctOnce(
  database: TenantWrappers,
  ids: IdGenerator,
  actor: AttendanceCorrectionActor,
  clock: AttendanceCorrectionClock,
  work: (scope: AttendanceCorrectionScope) => Promise<AttendanceCorrectionResult>,
): Promise<AttendanceCorrectionResult> {
  try {
    return await database.withTenant(
      actor.companyId,
      async (tx) => {
        const context = await load(tx, actor, clock);
        const result = await runIdempotent(
          tx,
          {
            scope: 'COMPANY',
            operation: 'correct-attendance-session',
            key: actor.key,
            fingerprint: fingerprintFor(actor),
          },
          async () => ({
            status: 200,
            body: await work({
              ...context,
              save: (plan) => saveAttendanceCorrection(tx, actor, ids, context.session, plan, context.now),
            }),
          }),
        );
        return result.body as AttendanceCorrectionResult;
      },
      { userId: actor.userId },
    );
  } catch (error) {
    persistenceError(error);
  }
}
