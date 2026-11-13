import type { LeaveHistoryQuery, LeaveHistoryReportStatus } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { leaveId } from '../api/leave-decision.fixture';
import { historyLeaveRow, historyPage } from '../api/leave-history.fixture';
import { readyReport } from '../api/leave-report.fixture';
import {
  isReportRequired,
  reportLastTaken,
  reportPage,
  reportViewState,
  toReportBody,
  type ReportViewInput,
} from './leave-report-view';

const query: LeaveHistoryQuery = {
  from: '2026-01-01',
  to: '2026-10-24',
  'types[]': [],
  'statuses[]': [],
  limit: 20,
};

const refusal = { code: 'LEAVE_HISTORY_REPORT_REQUIRED', status: 422 };
const syncFailure = { code: 'LEAVE_HISTORY_REPORT_NOT_FOUND', status: 404 };
const lastTaken = {
  annual: { from: '2026-01-05', to: '2026-01-09' },
  sick: null,
  unpaid: null,
};

function input(overrides: Partial<ReportViewInput> = {}): ReportViewInput {
  return {
    syncPending: false,
    syncError: undefined,
    postError: undefined,
    jobError: undefined,
    jobStatus: undefined,
    ...overrides,
  };
}

it('recognises the heavy refusal by its envelope code only', () => {
  expect(isReportRequired(refusal)).toBe(true);
  expect(isReportRequired({ code: 'OTHER_CODE', status: 422 })).toBe(false);
  expect(isReportRequired(null)).toBe(false);
});

it('builds the report body with the period, the filters and the branch', () => {
  const body = toReportBody({ ...query, branch_id: leaveId });
  expect(body).toEqual({
    from: '2026-01-01',
    to: '2026-10-24',
    'types[]': [],
    'statuses[]': [],
    branch_id: leaveId,
  });
  expect(Object.keys(body).sort()).toEqual(['branch_id', 'from', 'statuses[]', 'to', 'types[]']);
});

it('omits the branch from the report body when no branch is chosen', () => {
  expect(Object.keys(toReportBody(query)).sort()).toEqual(['from', 'statuses[]', 'to', 'types[]']);
});

it('never sends the employee, the cursor or the limit to the report request', () => {
  const body = toReportBody({ ...query, cursor: 'cursor-2' });
  expect(body).not.toHaveProperty('employee_id');
  expect(body).not.toHaveProperty('cursor');
  expect(body).not.toHaveProperty('limit');
  expect(Object.keys(body).sort()).toEqual(['from', 'statuses[]', 'to', 'types[]']);
});

it('shows the loading state while the fast read runs', () => {
  expect(reportViewState(input({ syncPending: true }))).toEqual({ status: 'loading' });
});

it('shows the ready state when the fast read answered', () => {
  expect(reportViewState(input())).toEqual({ status: 'ready' });
});

it('shows the envelope of a failed fast read as the error state', () => {
  expect(reportViewState(input({ syncError: syncFailure }))).toEqual({
    status: 'error',
    error: syncFailure,
  });
});

it('shows the preparing state while the heavy report runs', () => {
  expect(reportViewState(input({ syncError: refusal }))).toEqual({ status: 'preparing' });
});

it('shows the ready state when the heavy report finished', () => {
  const jobStatus: LeaveHistoryReportStatus = readyReport();
  expect(reportViewState(input({ syncError: refusal, jobStatus }))).toEqual({ status: 'ready' });
});

it('shows the stored failure of the heavy report', () => {
  const error = {
    code: 'LEAVE_HISTORY_REPORT_FAILED' as const,
    message_ar: 'Synthetic failure',
    message_en: 'Synthetic failure',
  };
  const jobStatus: LeaveHistoryReportStatus = { status: 'failed', error };
  expect(reportViewState(input({ syncError: refusal, jobStatus }))).toEqual({
    status: 'failed',
    error,
  });
});

it('shows the error state when the report request is refused', () => {
  const postError = { code: 'LEAVE_HISTORY_REPORT_BUSY', status: 409 };
  expect(reportViewState(input({ syncError: refusal, postError }))).toEqual({
    status: 'error',
    error: postError,
  });
});

it('shows the error state when the report result read fails', () => {
  const jobError = { code: 'LEAVE_HISTORY_REPORT_NOT_FOUND', status: 404 };
  expect(reportViewState(input({ syncError: refusal, jobError }))).toEqual({
    status: 'error',
    error: jobError,
  });
});

it('prefers the stored report page over the fast read page', () => {
  const stored = historyLeaveRow({ note: 'Synthetic stored row' });
  const fast = historyLeaveRow({ note: 'Synthetic fast row' });
  const page = reportPage(historyPage({ items: [fast] }), readyReport({ items: [stored] }));
  expect(page?.items).toEqual([stored]);
});

it('falls back to the fast read page when no report is stored', () => {
  const fast = historyLeaveRow({ note: 'Synthetic fast row' });
  expect(reportPage(historyPage({ items: [fast] }), undefined)?.items).toEqual([fast]);
});

it('has no page before any read answers', () => {
  expect(reportPage(undefined, undefined)).toBeUndefined();
});

it('shows the last taken line only when an employee is chosen', () => {
  const page = historyPage({ last_taken: lastTaken });
  expect(reportLastTaken(page, leaveId)).toEqual(lastTaken);
  expect(reportLastTaken(page, '')).toBeUndefined();
  expect(reportLastTaken(undefined, leaveId)).toBeUndefined();
});
