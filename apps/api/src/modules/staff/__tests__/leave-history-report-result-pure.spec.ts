import { describe, expect, it } from 'vitest';
import type { LeaveHistoryReportStoredScope } from '@pospay/contracts';
import {
  LEAVE_HISTORY_REPORT_PAGE_WINDOW,
  nextPageCursorSeq,
} from '../queries/leave-history-report-page.sql.ts';
import {
  leaveHistoryReportScopeIsStale,
  type LeaveHistoryReportCurrentScope,
} from '../queries/leave-history-report-stale.ts';

describe('nextPageCursorSeq (pure)', () => {
  it('returns seq at limit-1 when visible rows exceed limit', () => {
    const visible = [1, 2, 3, 4, 5, 6];
    const next = nextPageCursorSeq(visible, 0, 5, 100);
    expect(next).toBe(5);
  });

  it('advances by window of 1,000 when visible rows <= limit and window is within rowCount', () => {
    const visible = [1, 2, 3];
    const next = nextPageCursorSeq(visible, 0, 5, 2500);
    expect(next).toBe(LEAVE_HISTORY_REPORT_PAGE_WINDOW);
  });

  it('returns null when visible rows <= limit and window reaches or exceeds rowCount', () => {
    const visible = [2001, 2002];
    const next = nextPageCursorSeq(visible, 2000, 50, 2500);
    expect(next).toBeNull();
  });

  it('advances window even when page is completely empty but window remains within rowCount', () => {
    const visible: number[] = [];
    const next = nextPageCursorSeq(visible, 0, 100, 2500);
    expect(next).toBe(1000);
  });

  it('returns null when empty page is at the end of the report rows', () => {
    const visible: number[] = [];
    const next = nextPageCursorSeq(visible, 2000, 100, 2500);
    expect(next).toBeNull();
  });
});

describe('leaveHistoryReportScopeIsStale (pure)', () => {
  const baseFrozen: LeaveHistoryReportStoredScope = {
    branches: ['b1', 'b2'],
    attendanceBranches: ['b1'],
    cancelBranches: ['b1'],
    decideBranches: ['b1'],
    revokeBranches: ['b1'],
    createBranches: ['b1'],
    eligibilityBranchIds: ['b1'],
  };

  const baseCurrent: LeaveHistoryReportCurrentScope = {
    branches: ['b1', 'b2'],
    attendanceBranches: ['b1'],
    eligibilityBranchIds: ['b1'],
  };

  it('returns false when current scope contains all frozen branch sets', () => {
    expect(leaveHistoryReportScopeIsStale(baseFrozen, baseCurrent)).toBe(false);
  });

  it('returns false when current scope has additional branches', () => {
    const expandedCurrent = {
      branches: ['b1', 'b2', 'b3'],
      attendanceBranches: ['b1', 'b2'],
      eligibilityBranchIds: ['b1', 'b3'],
    };
    expect(leaveHistoryReportScopeIsStale(baseFrozen, expandedCurrent)).toBe(false);
  });

  it('returns true when a frozen read branch is missing from current branches', () => {
    const missingRead = {
      ...baseCurrent,
      branches: ['b1'], // missing b2
    };
    expect(leaveHistoryReportScopeIsStale(baseFrozen, missingRead)).toBe(true);
  });

  it('returns true when a frozen attendance branch is missing from current attendance branches', () => {
    const missingAttendance = {
      ...baseCurrent,
      attendanceBranches: ['b2'], // missing b1
    };
    expect(leaveHistoryReportScopeIsStale(baseFrozen, missingAttendance)).toBe(true);
  });

  it('returns true when a frozen eligibility branch is missing from current eligibility branch ids', () => {
    const missingEligibility = {
      ...baseCurrent,
      eligibilityBranchIds: ['b2'], // missing b1
    };
    expect(leaveHistoryReportScopeIsStale(baseFrozen, missingEligibility)).toBe(true);
  });

  it('does not compare dates so midnight transition does not cause staleness', () => {
    // Current scope has the same branch ids regardless of eligibility date boundaries
    expect(leaveHistoryReportScopeIsStale(baseFrozen, baseCurrent)).toBe(false);
  });
});
