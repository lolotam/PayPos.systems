import type { LeaveHistoryItem, LeaveHistoryPage, LeavePage } from '@pospay/contracts';
import { leaveDecisionRecord, leaveId } from './leave-decision.fixture';

type LeaveRow = Extract<LeaveHistoryItem, { row_type: 'LEAVE' }>;
type AbsenceRow = Extract<LeaveHistoryItem, { row_type: 'UNEXCUSED_ABSENCE' }>;
type CoveredRow = Extract<LeaveHistoryItem, { row_type: 'COVERED_ELSEWHERE' }>;

export function historyLeaveRow(overrides: Partial<LeaveRow> = {}): LeaveRow {
  return {
    ...leaveDecisionRecord,
    row_type: 'LEAVE',
    employee_number: 1,
    note: 'Synthetic past annual',
    ...overrides,
  };
}

export function absenceRow(overrides: Partial<AbsenceRow> = {}): AbsenceRow {
  return {
    id: leaveId,
    row_type: 'UNEXCUSED_ABSENCE',
    employee_id: leaveId,
    employee_name_en: 'Synthetic employee',
    employee_name_ar: null,
    employee_number: 1,
    working_date: '2026-10-12',
    branch_id: leaveId,
    shifts: [{ start: '09:00', end: '13:00' }],
    status: 'ABSENT',
    ...overrides,
  };
}

export function coveredRow(overrides: Partial<CoveredRow> = {}): CoveredRow {
  return {
    id: leaveId,
    row_type: 'COVERED_ELSEWHERE',
    employee_id: leaveId,
    employee_name_en: 'Synthetic employee',
    employee_name_ar: null,
    employee_number: 1,
    working_date: '2026-10-13',
    branch_id: leaveId,
    shift: { start: '14:00', end: '18:00' },
    ...overrides,
  };
}

export function historyPage(overrides: Partial<LeaveHistoryPage> = {}): LeaveHistoryPage {
  return {
    items: [],
    next_cursor: null,
    as_of: '2026-10-24T09:00:00.000Z',
    last_taken: null,
    request_branch_ids: [leaveId],
    absence_branch_ids: [leaveId],
    ...overrides,
  };
}

export function openPage(overrides: Partial<LeavePage> = {}): LeavePage {
  return {
    items: [],
    next_cursor: null,
    request_branch_ids: [leaveId],
    ...overrides,
  };
}
