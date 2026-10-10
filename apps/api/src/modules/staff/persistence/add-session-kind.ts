import type { IdGenerator } from '@pospay/db';
import { AttendanceChangeError } from '../domain/attendance-change-request.ts';
import { planManualSession } from '../domain/manual-attendance-session.ts';
import type { AttendanceChangeKind } from '../ports/attendance-change-kinds.port.ts';
import { manualSessionContext, manualSessionTarget } from './manual-session-context.adapter.ts';
import { insertManualSession } from './manual-session-writes.ts';

export function createAddSessionKind(ids: IdGenerator): AttendanceChangeKind {
  return {
    code: 'ADD_SESSION',
    target: manualSessionTarget,
    check: async (scope) => {
      const { clock_in, clock_out } = scope.input;
      if (!clock_in || !clock_out)
        throw new AttendanceChangeError('ATTENDANCE_MANUAL_INVALID_TIMES');
      const plan = planManualSession(
        { branch_id: scope.target.branch_id, clock_in, clock_out },
        await manualSessionContext(scope),
      );
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
      if (!values.manualPlan) throw new AttendanceChangeError('ATTENDANCE_MANUAL_INVALID_TIMES');
      return { ...values, session_id: await insertManualSession(scope, values.manualPlan, ids) };
    },
  };
}
