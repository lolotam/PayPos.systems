import type { IdGenerator, Tx } from '@pospay/db';
import { planAttendanceRestore } from '../domain/attendance-void.ts';
import type {
  AttendanceChangeKind,
  AttendanceChangeKindScope,
} from '../ports/attendance-change-kinds.port.ts';
import { correctionNeighbours } from './attendance-correction-records.ts';
import {
  assertNoPendingSessionChange,
  lockVoidSession,
  voidSessionRequest,
  voidSessionTarget,
  voidSessionValues,
  writeVoidSession,
} from './void-session-writes.ts';

async function restorePlan(
  scope: AttendanceChangeKindScope,
  session: Awaited<ReturnType<typeof lockVoidSession>>,
) {
  const neighbours = await correctionNeighbours(
    scope.transaction as Tx,
    scope.companyId,
    scope.target.employee_id,
    session,
  );
  return planAttendanceRestore(session, voidSessionRequest(scope), { neighbours });
}

export function createRestoreSessionKind(ids: IdGenerator): AttendanceChangeKind {
  return {
    code: 'RESTORE_SESSION',
    target: voidSessionTarget,
    check: async (scope) => {
      const session = await lockVoidSession(scope);
      await assertNoPendingSessionChange(scope);
      await restorePlan(scope, session);
      return voidSessionValues(session);
    },
    apply: async (scope) => {
      const session = await lockVoidSession(scope);
      return writeVoidSession(scope, ids, session, await restorePlan(scope, session), 'restored');
    },
  };
}
