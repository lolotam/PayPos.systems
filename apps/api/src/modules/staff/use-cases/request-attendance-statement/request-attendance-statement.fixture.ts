import type { AttendanceStatementRequest } from '@pospay/contracts';
import type { ReportBranchInputs } from '@pospay/domain';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { RateLimiter } from '../../../../shared/ports/rate-limiter.port.ts';
import type {
  AttendanceStatementTransactions,
  DocumentRenderTransport,
  StatementRenderJob,
  StatementRequestRow,
} from '../../ports/attendance-statement.port.ts';
import { RequestAttendanceStatementUseCase } from './request-attendance-statement.usecase.ts';

export const statementNow = new Date('2026-10-23T07:00:00.000Z');

export const statementBase: AttendanceStatementRequest = {
  form: 'BRANCH',
  from: '2026-10-23',
  to: '2026-10-23',
  language: 'ar',
};

const at = (time: string) => `2026-10-23T${time}:00+03:00`;

/** مدخلات فرع اصطناعية فيها وردية واحدة؛ نهايتها هي اللي بتتغير في كل حالة. */
export function inputsWithShift(end: string): ReportBranchInputs {
  return {
    timezone: 'Asia/Kuwait',
    sessions: [],
    shifts: [
      {
        working_date: '2026-10-23',
        starts_at: at('08:00'),
        ends_at: at(end),
        break_starts_at: null,
        break_ends_at: null,
      },
    ],
    contract: null,
    leave_for_branch: [],
  };
}

/** حالة الطلب أثناء الاختبار: اللي بتتحكم فيه كل حالة refusal. */
export interface StatementRequestState {
  alive: boolean;
  queueFails: boolean;
  acceptedAfterError: boolean;
  reconciliationFails: boolean;
  limitHits: number;
  branch: { id: string; timezone: string } | null;
  inputs: ReportBranchInputs | null;
  inserted: StatementRequestRow[];
  queued: StatementRenderJob[];
  failed: string[];
}

export interface StatementRequestFixture {
  state: StatementRequestState;
  execute(input?: Partial<AttendanceStatementRequest>): Promise<{ render_id: string }>;
}

function statementState(): StatementRequestState {
  return {
    alive: true,
    queueFails: false,
    acceptedAfterError: false,
    reconciliationFails: false,
    limitHits: 0,
    branch: { id: 'branch-1', timezone: 'Asia/Kuwait' },
    inputs: inputsWithShift('09:30'),
    inserted: [],
    queued: [],
    failed: [],
  };
}

function statementRateLimiter(state: StatementRequestState): RateLimiter {
  return {
    hit: async () => {
      state.limitHits += 1;
      return state.limitHits <= 20;
    },
    remember: async () => undefined,
    remembered: async () => false,
    count: async () => state.limitHits,
    remaining: async () => 3600,
  };
}

function statementTransactions(state: StatementRequestState): AttendanceStatementTransactions {
  return {
    run: async (_scope, work) =>
      work({
        branch: async () => state.branch,
        employeeInputs: async () => state.inputs,
        logo: { read: async () => 'logo-file-1' },
        insert: async (row) => {
          state.inserted.push(row);
        },
      }),
  };
}

function statementTransport(state: StatementRequestState): DocumentRenderTransport {
  return {
    rendererAlive: async () => state.alive,
    queue: async (job) => {
      if (state.queueFails) throw new Error('queue unavailable');
      state.queued.push(job);
    },
    markFailed: async (companyId, renderId) => {
      if (state.reconciliationFails) throw new Error('Redis unavailable');
      if (state.acceptedAfterError) return false;
      state.failed.push(`${companyId}:${renderId}`);
      return true;
    },
  };
}

/** بينزّل use case بمزودين مزيفين؛ كل حالة اختبار تغيّر في state وتشغّل execute. */
export function createStatementRequestFixture(): StatementRequestFixture {
  const state = statementState();
  const clock: Clock = { now: () => statementNow };
  const useCase = new RequestAttendanceStatementUseCase(
    statementTransactions(state),
    statementTransport(state),
    statementRateLimiter(state),
    clock,
    { newId: () => 'render-1' },
  );
  const execute = (input: Partial<AttendanceStatementRequest> = {}) =>
    useCase.execute({
      companyId: 'company-1',
      userId: 'user-1',
      businessId: 'business-1',
      branchId: 'branch-1',
      input: { ...statementBase, ...input },
    });
  return { state, execute };
}
