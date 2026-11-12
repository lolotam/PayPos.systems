import { describe, expect, it } from 'vitest';
import {
  LEAVE_HISTORY_REPORT_CLEANUP_EVERY_MS,
  LEAVE_HISTORY_REPORT_FAILURE_CODES,
  LEAVE_HISTORY_REPORT_RETENTION_MS,
  LEAVE_HISTORY_REPORT_ROW_CAP,
  leaveHistoryReportJob,
  leaveHistoryReportRequested,
  leaveHistoryReportStoredQuery,
  leaveHistoryReportStoredScope,
} from './leave-history-report-job.js';

const ID = '01920000-0000-7000-8000-000000000001';
const OTHER_ID = '01920000-0000-7000-8000-000000000002';
const query = {
  from: '2026-01-01',
  to: '2026-12-31',
  'types[]': ['ANNUAL', 'UNEXCUSED_ABSENCE'],
  'statuses[]': ['APPROVED', 'ABSENT'],
  branch_id: ID,
};
const scope = {
  branches: [ID],
  attendanceBranches: [ID],
  cancelBranches: [],
  decideBranches: [ID, OTHER_ID],
  revokeBranches: [],
  createBranches: [],
  eligibilityBranchIds: [ID],
};

describe('leaveHistoryReportRequested and leaveHistoryReportJob', () => {
  it('parses valid id-only payloads', () => {
    expect(leaveHistoryReportRequested.parse({ report_id: ID })).toEqual({ report_id: ID });
    expect(leaveHistoryReportJob.parse({ companyId: ID, reportId: OTHER_ID })).toEqual({
      companyId: ID,
      reportId: OTHER_ID,
    });
  });

  it.each([
    { report_id: 'not-a-uuid' },
    { report_id: ID, extra: true },
    {},
  ])('refuses an invalid requested event %#', (input) => {
    expect(leaveHistoryReportRequested.safeParse(input).success).toBe(false);
  });

  it.each([
    { companyId: 'bad', reportId: OTHER_ID },
    { companyId: ID, reportId: OTHER_ID, extra: true },
    { companyId: ID },
  ])('refuses an invalid worker job %#', (input) => {
    expect(leaveHistoryReportJob.safeParse(input).success).toBe(false);
  });
});

describe('leaveHistoryReportStoredQuery', () => {
  it('parses a bounded stored query', () => {
    expect(leaveHistoryReportStoredQuery.parse(query)).toEqual(query);
    expect(leaveHistoryReportStoredQuery.parse({ ...query, from: '2026-01-01', to: '2027-01-01' })).toMatchObject({
      from: '2026-01-01',
      to: '2027-01-01',
    });
  });

  it.each([
    { ...query, from: '0000-01-01' },
    { ...query, from: '2026-02-31', to: '2026-03-01' },
    { ...query, from: '2026-04-31', to: '2026-05-01' },
    { ...query, from: '2026-02-29', to: '2026-03-01' },
    { ...query, to: 'not-a-date' },
    { ...query, from: '2026-02-01', to: '2026-01-01' },
    { ...query, from: '2026-01-01', to: '2027-01-02' },
    { ...query, 'types[]': ['UNKNOWN'] },
    { ...query, 'statuses[]': ['UNKNOWN'] },
    { ...query, branch_id: 'bad' },
    { ...query, employee_id: ID },
    { ...query, limit: 100 },
  ])('refuses malformed dates, ranges, enums, ids and unknown keys %#', (input) => {
    expect(leaveHistoryReportStoredQuery.safeParse(input).success).toBe(false);
  });
});

describe('leaveHistoryReportStoredScope', () => {
  it('parses every frozen branch set', () => {
    expect(leaveHistoryReportStoredScope.parse(scope)).toEqual(scope);
  });

  it.each([
    { ...scope, branches: ['bad'] },
    { ...scope, eligibilityBranchIds: 'not-an-array' },
    { ...scope, extra: [] },
    Object.fromEntries(Object.entries(scope).filter(([key]) => key !== 'branches')),
  ])('refuses invalid scope ids, shapes and keys %#', (input) => {
    expect(leaveHistoryReportStoredScope.safeParse(input).success).toBe(false);
  });
});

it('pins the PP-178 limits and permanent failure-code tuple', () => {
  expect(LEAVE_HISTORY_REPORT_ROW_CAP).toBe(25_000);
  expect(LEAVE_HISTORY_REPORT_RETENTION_MS).toBe(3_600_000);
  expect(LEAVE_HISTORY_REPORT_CLEANUP_EVERY_MS).toBe(3_600_000);
  expect(LEAVE_HISTORY_REPORT_FAILURE_CODES).toEqual([
    'LEAVE_HISTORY_REPORT_FAILED',
    'LEAVE_HISTORY_REPORT_TOO_LARGE',
  ]);
});
