import type {
  AttendanceExceptionPage,
  AttendanceChangeRequestPage,
  AttendanceCorrectionHistory,
  AttendanceEmployeePage,
} from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { boardFixture, boardId, boardScope, otherBoardId } from './attendance-board.fixture';
export { boardId, boardScope, otherBoardId };
const firstSession = boardFixture.sessions[0];
if (!firstSession) throw new Error('Synthetic session missing');
export const actionSession = { ...firstSession, source: 'QR' as const, manual: null };
export const exceptionPage: AttendanceExceptionPage = {
  items: [
    {
      id: boardId,
      branch_id: boardId,
      kind: 'NONE',
      status: 'OPEN',
      resolution: null,
      resolved_by: null,
      resolved_at: null,
      reason: null,
      raised_at: '2026-10-10T21:30:00Z',
      revision: 3,
      employee: { id: otherBoardId, name_ar: null, name_en: 'Synthetic employee' },
      session: {
        id: boardId,
        working_date: '2026-10-11',
        clock_in: '2026-10-10T21:30:00Z',
        clock_out: '2026-10-11T02:00:00Z',
        status: 'CLOSED',
      },
    },
  ],
  next_cursor: `2026-10-10T21:30:00Z|${boardId}`,
};
export const exceptionRecord = {
  ...exceptionPage.items[0],
  session_id: boardId,
  employee_id: otherBoardId,
};
delete (exceptionRecord as Record<string, unknown>).session;
delete (exceptionRecord as Record<string, unknown>).employee;
export const requestPage: AttendanceChangeRequestPage = {
  items: [
    {
      id: boardId,
      kind: 'VOID_SESSION',
      status: 'PENDING',
      business_id: boardId,
      branch_id: boardId,
      employee: { id: otherBoardId, name_ar: null, name_en: 'Synthetic employee' },
      session_id: boardId,
      session_revision: 3,
      session_state: { voided: false, void_request_id: null, restore_pending: false },
      requested: {
        working_date: '2026-10-11',
        clock_in: '2026-10-10T21:30:00Z',
        clock_out: '2026-10-11T02:00:00Z',
        timezone: 'Asia/Kuwait',
      },
      reason: 'Synthetic request reason',
      requested_by: boardId,
      requested_at: '2026-10-11T04:00:00Z',
      requested_by_name: { ar: null, en: 'Synthetic requester' },
      decided_by: null,
      decided_by_name: null,
      decided_at: null,
      decision_reason: null,
      cancelled_by: null,
      cancelled_at: null,
      revision: 2,
      can_decide: true,
      can_cancel: true,
    },
  ],
  next_cursor: 'synthetic-cursor',
};
export const requestRecord = { ...requestPage.items[0] };
delete (requestRecord as Record<string, unknown>).requested_by_name;
delete (requestRecord as Record<string, unknown>).decided_by_name;
delete (requestRecord as Record<string, unknown>).session_state;
export const historyFixture: AttendanceCorrectionHistory = {
  items: [
    {
      id: boardId,
      field: 'CLOCK_OUT',
      before_at: '2026-10-11T02:00:00Z',
      after_at: '2026-10-11T01:00:00Z',
      reason: 'Synthetic correction reason',
      corrected_by: { id: boardId, name: { ar: null, en: 'Synthetic corrector' } },
      corrected_at: '2026-10-11T04:00:00Z',
    },
  ],
};
export const correctionResult = {
  session: {
    id: boardId,
    employee_id: otherBoardId,
    branch_id: boardId,
    working_date: '2026-10-11',
    clock_in: '2026-10-10T21:30:00Z',
    clock_out: '2026-10-11T01:00:00Z',
    status: 'MISSED_OUT',
    closed_by: 'MISSED_OUT',
    late_minutes: 12,
    revision: 2,
  },
  corrections: [],
};
export const employeesFixture: AttendanceEmployeePage = {
  items: [
    {
      id: otherBoardId,
      name_ar: null,
      name_en: 'Synthetic employee',
    },
  ],
  next_cursor: null,
};
export function attendanceTestClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
