import type { AttendanceChangeRequest } from '@pospay/contracts';
import {
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { createHash } from 'node:crypto';
import { AttendanceChangeError } from '../domain/attendance-change-request.ts';
import {
  AttendanceChangeKindRefusal,
  type AttendanceChangeKind,
  type AttendanceChangeKindInput,
  type AttendanceChangeKindScope,
  type AttendanceChangeKinds,
  type AttendanceChangeTarget,
} from '../ports/attendance-change-kinds.port.ts';
import type {
  AttendanceChangeActor,
  AttendanceChangeClock,
  AttendanceChangeScope,
  AttendanceChangeTransactions,
} from '../ports/attendance-change-transactions.port.ts';
import {
  attendanceChangeAuthority,
  attendanceChangeAuthorityLock,
} from './attendance-change-context.adapter.ts';
import { changeEmployee, lockChangeState, readChangeRequest } from './attendance-change-records.ts';
import { holdAttendanceChange, saveAttendanceChange } from './attendance-change-writes.ts';

type Action = 'file' | 'cancel' | 'decide';
type Filing = { input: AttendanceChangeKindInput; kind: AttendanceChangeKind; requestId: string };
type Work = (scope: AttendanceChangeScope) => Promise<AttendanceChangeRequest>;

function assertAuthority(
  action: Action,
  actor: AttendanceChangeActor,
  access: { owner: boolean; member: boolean; canRequest: boolean; canDecide: boolean },
  before: AttendanceChangeRequest | null,
) {
  if (
    (action === 'decide' && !access.canDecide) ||
    (action === 'file' && !access.canRequest) ||
    (action === 'cancel' && (before?.requested_by !== actor.userId || !access.member))
  )
    throw new AttendanceChangeError('NOT_FOUND');
}
function readAuthority(tx: Tx, actor: AttendanceChangeActor, branchId: string, now: Date) {
  return attendanceChangeAuthority(
    tx,
    actor.companyId,
    actor.userId,
    actor.businessId,
    branchId,
    now,
  );
}
async function loadTarget(
  scope: Omit<AttendanceChangeKindScope, 'target' | 'request' | 'input' | 'requestId'>,
  candidate: AttendanceChangeRequest | null,
  filing?: Filing,
) {
  if (filing) return filing.kind.target({ ...scope, input: filing.input });
  return candidate ? { employee_id: candidate.employee.id, branch_id: candidate.branch_id } : null;
}
function assertTarget(before: AttendanceChangeRequest | null, target: AttendanceChangeTarget) {
  if (
    before &&
    (before.employee.id !== target.employee_id || before.branch_id !== target.branch_id)
  )
    throw new AttendanceChangeError('NOT_FOUND');
}
async function load(
  tx: Tx,
  actor: AttendanceChangeActor,
  action: Action,
  clock: AttendanceChangeClock,
  kinds: AttendanceChangeKinds,
  filing?: Filing,
) {
  const sample = clock.now();
  const candidate = filing ? null : await readChangeRequest(tx, actor);
  const requestId = filing ? filing.requestId : candidate?.id;
  if (!requestId) throw new AttendanceChangeError('NOT_FOUND');
  const target = await loadTarget(
    { transaction: tx, ...actor, now: sample },
    candidate,
    filing,
  );
  if (!target) throw new AttendanceChangeError('NOT_FOUND');
  const initial = await readAuthority(tx, actor, target.branch_id, sample);
  assertAuthority(action, actor, initial, candidate);
  await lockChangeState(tx, actor.companyId, target.employee_id);
  if (!(await attendanceChangeAuthorityLock(tx, actor.companyId)))
    throw new AttendanceChangeError('NOT_FOUND');
  const before = filing ? null : await readChangeRequest(tx, actor, true);
  assertTarget(before, target);
  const employee = await changeEmployee(tx, actor, target.employee_id);
  if (!filing && !before) throw new AttendanceChangeError('NOT_FOUND');
  const input = filing ? filing.input : inputFrom(before as AttendanceChangeRequest);
  const kind =
    action === 'file' ? filing?.kind : action === 'decide' ? kinds.find(input.kind) : null;
  await kind?.lock?.({
    transaction: tx,
    ...actor,
    requestId,
    target,
    input,
    now: sample,
    request: before,
  });
  const now = clock.now();
  const access = await readAuthority(tx, actor, target.branch_id, now);
  assertAuthority(action, actor, access, before);
  return {
    requestId,
    target,
    before,
    request: before,
    input,
    employee,
    employeeUserId: employee.user_id,
    now,
    owner: access.owner,
    canRequest: access.canRequest,
    canDecide: access.canDecide,
  };
}
function inputFrom(row: AttendanceChangeRequest): AttendanceChangeKindInput {
  return {
    kind: row.kind,
    employee_id: row.employee.id,
    reason: row.reason,
    ...(row.requested
      ? {
          branch_id: row.branch_id,
          clock_in: row.requested.clock_in,
          clock_out: row.requested.clock_out,
        }
      : {}),
    ...(row.session_id === null ? {} : { session_id: row.session_id }),
    ...(row.session_revision === null ? {} : { session_revision: row.session_revision }),
  };
}
export function createAttendanceChangeTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  kinds: AttendanceChangeKinds,
): AttendanceChangeTransactions {
  const run = (
    actor: AttendanceChangeActor,
    action: Action,
    clock: AttendanceChangeClock,
    work: Work,
    filing?: Filing,
  ) => changeOnce(database, ids, kinds, actor, action, clock, work, filing);
  return {
    file: (actor, input, kind, clock, requestId, work) =>
      run(actor, 'file', clock, work, { input, kind, requestId }),
    cancel: (actor, clock, work) => run(actor, 'cancel', clock, work),
    decide: (actor, clock, work) => run(actor, 'decide', clock, work),
  };
}
async function changeOnce(
  database: TenantWrappers,
  ids: IdGenerator,
  kinds: AttendanceChangeKinds,
  actor: AttendanceChangeActor,
  action: Action,
  clock: AttendanceChangeClock,
  work: Work,
  filing?: Filing,
): Promise<AttendanceChangeRequest> {
  try {
    return await database.withTenant(
      actor.companyId,
      async (tx) => {
        const context = await load(tx, actor, action, clock, kinds, filing);
        const result = await runIdempotent(
          tx,
          {
            scope: 'COMPANY',
            operation: `${action}-attendance-change`,
            key: actor.key,
            fingerprint: createHash('sha256')
              .update(
                JSON.stringify([
                  action,
                  actor.userId,
                  actor.businessId,
                  actor.requestId,
                  actor.fingerprint,
                ]),
              )
              .digest('hex'),
          },
          async () => ({
            status: action === 'file' ? 201 : 200,
            body: await work({
              ...actor,
              ...context,
              transaction: tx,
              hold: (plan, values) => holdAttendanceChange(tx, ids, actor, context, plan, values),
              save: (plan, values) => saveAttendanceChange(tx, ids, actor, context, plan, values),
            }),
          }),
        );
        return result.body as AttendanceChangeRequest;
      },
      { userId: actor.userId },
    );
  } catch (error) {
    persistenceError(error);
  }
}
function persistenceError(error: unknown): never {
  if (
    error instanceof AttendanceChangeError ||
    error instanceof AttendanceChangeKindRefusal ||
    error instanceof IdempotencyKeyBusyError ||
    error instanceof IdempotencyKeyReusedError
  )
    throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    if (['40001', '40P01', '55P03'].includes(String(cause.code)))
      throw new AttendanceChangeError('TRANSACTION_RETRY_REQUIRED');
    if (
      cause.code === '23505' &&
      'constraint_name' in cause &&
      cause.constraint_name === 'attendance_change_requests_one_pending_void'
    )
      throw new AttendanceChangeError('ATTENDANCE_CHANGE_DUPLICATE_PENDING');
  }
  throw new Error('ATTENDANCE_CHANGE_PERSISTENCE_FAILED', { cause: error });
}
