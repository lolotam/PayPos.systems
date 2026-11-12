import { describe, expect, it } from 'vitest';
import {
  classifyLeaveHistoryReportError,
  leaveHistoryReportExceedsRowCap,
} from '../leave-history-report.ts';

describe('classifyLeaveHistoryReportError', () => {
  it('maps the named size refusal to TOO_LARGE', () => {
    const error = Object.assign(new Error('private detail'), {
      name: 'LeaveHistoryReportTooLargeError',
    });
    expect(classifyLeaveHistoryReportError(error)).toBe('LEAVE_HISTORY_REPORT_TOO_LARGE');
  });

  it.each([
    'LeaveHistoryReportDeadlineError',
    'LeaveHistoryReportInputError',
    'TimeoutError',
  ])('maps %s to a permanent failure', (name) => {
    expect(classifyLeaveHistoryReportError(Object.assign(new Error('private'), { name }))).toBe(
      'LEAVE_HISTORY_REPORT_FAILED',
    );
  });

  it.each(['57014', '25P03'])('maps SQLSTATE %s to a permanent failure', (code) => {
    expect(classifyLeaveHistoryReportError({ code })).toBe('LEAVE_HISTORY_REPORT_FAILED');
  });

  it.each([
    new Error('driver detail'),
    { code: '40001' },
    { name: 'TimeoutError' },
    null,
    undefined,
    'TimeoutError',
  ])('retries an unrecognized error %#', (error) => {
    expect(classifyLeaveHistoryReportError(error)).toBe('RETRY');
  });

  it('checks the size refusal before another SQLSTATE', () => {
    const error = Object.assign(new Error('private'), {
      name: 'LeaveHistoryReportTooLargeError',
      code: '57014',
    });
    expect(classifyLeaveHistoryReportError(error)).toBe('LEAVE_HISTORY_REPORT_TOO_LARGE');
  });
});

describe('leaveHistoryReportExceedsRowCap', () => {
  it.each([
    { count: 1, cap: 2, expected: false },
    { count: 2, cap: 2, expected: false },
    { count: 3, cap: 2, expected: true },
  ])('returns $expected for $count rows with cap $cap', ({ count, cap, expected }) => {
    expect(leaveHistoryReportExceedsRowCap(count, cap)).toBe(expected);
  });
});
