import type { IdGenerator } from '@pospay/db';
import { AttendanceChangeError } from '../domain/attendance-change-request.ts';
import { planManualSession } from '../domain/manual-attendance-session.ts';
import {
  AttendanceChangeKindRefusal,
  type AttendanceChangeKind,
} from '../ports/attendance-change-kinds.port.ts';
import {
  lockManualSessionContext,
  manualSessionContext,
  manualSessionTarget,
} from './manual-session-context.adapter.ts';
import { insertManualSession } from './manual-session-writes.ts';

const REFUSALS: Readonly<Record<string, 409 | 422>> = {
  ATTENDANCE_MANUAL_INVALID_TIMES: 422,
  ATTENDANCE_MANUAL_NOT_ELIGIBLE: 422,
  ATTENDANCE_MANUAL_TIMEZONE_CHANGED: 409,
  ATTENDANCE_CHANGE_DUPLICATE_PENDING: 409,
};

function asRefusal(error: unknown): never {
  const status = error instanceof AttendanceChangeError ? REFUSALS[error.code] : undefined;
  if (status && error instanceof AttendanceChangeError)
    throw new AttendanceChangeKindRefusal(error.code, status);
  throw error;
}

function refuse(code: keyof typeof REFUSALS & string): never {
  throw new AttendanceChangeKindRefusal(code, REFUSALS[code] ?? 422);
}

export function createAddSessionKind(ids: IdGenerator): AttendanceChangeKind {
  return {
    code: 'ADD_SESSION',
    target: manualSessionTarget,
    lock: lockManualSessionContext,
    check: async (scope) => {
      const { clock_in, clock_out } = scope.input;
      if (!clock_in || !clock_out) refuse('ATTENDANCE_MANUAL_INVALID_TIMES');
      const plan = await manualSessionContext(scope)
        .then((context) =>
          planManualSession({ branch_id: scope.target.branch_id, clock_in, clock_out }, context),
        )
        .catch(asRefusal);
      return {
        session_id: null,
        session_revision: null,
        manualPlan: plan,
        manual: {
          clock_in: plan.clock_in,
          clock_out: plan.clock_out,
          working_date: plan.working_date,
          timezone: plan.timezone,
        },
      };
    },
    apply: async (scope, values) => {
      if (!values.manualPlan) refuse('ATTENDANCE_MANUAL_INVALID_TIMES');
      return { ...values, session_id: await insertManualSession(scope, values.manualPlan, ids) };
    },
  };
}
