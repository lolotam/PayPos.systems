import type { IdGenerator } from '@pospay/db';
import { planAttendanceVoid } from '../domain/attendance-void.ts';
import type {
  AttendanceChangeKind,
  AttendanceChangeKindScope,
} from '../ports/attendance-change-kinds.port.ts';
import {
  assertNoPendingSessionChange,
  lockVoidSession,
  voidSessionRequest,
  voidSessionTarget,
  voidSessionValues,
  writeVoidSession,
} from './void-session-writes.ts';

const context = (scope: AttendanceChangeKindScope) => ({
  now: scope.now,
  approverId: scope.userId,
  requestId: scope.requestId,
});

export function createVoidSessionKind(ids: IdGenerator): AttendanceChangeKind {
  return {
    code: 'VOID_SESSION',
    target: voidSessionTarget,
    lock: async (scope) => {
      await lockVoidSession(scope);
    },
    check: async (scope) => {
      const session = await lockVoidSession(scope);
      await assertNoPendingSessionChange(scope);
      planAttendanceVoid(session, voidSessionRequest(scope), context(scope));
      return voidSessionValues(session);
    },
    apply: async (scope) => {
      const session = await lockVoidSession(scope);
      const plan = planAttendanceVoid(session, voidSessionRequest(scope), context(scope));
      return writeVoidSession(scope, ids, session, plan, 'voided');
    },
  };
}
