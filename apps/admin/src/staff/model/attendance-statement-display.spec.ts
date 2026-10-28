import { describe, expect, it, vi } from 'vitest';

import {
  statementAccessLost,
  statementBranchName,
  statementCurrentMonthEnd,
  statementDefaultPeriod,
  statementEmployeeName,
  statementErrorMessage,
  statementFileName,
  statementMonthRange,
  statementMonthsInPeriod,
  statementPeriodIsValid,
  statementRenderAccessLost,
  statementRenderCodeMessage,
  statementRenderErrorMessage,
} from './attendance-statement-display';

// 2026-09-30T22:00Z هو 2026-10-01 01:00 في الكويت و 2026-09-30 18:00 في نيويورك.
function withClock<T>(run: () => T): T {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T22:00:00Z'));
  try {
    return run();
  } finally {
    vi.useRealTimers();
  }
}

describe('attendance statement display', () => {
  it('builds the file name of FR-007 for both forms', () => {
    const period = { from: '2026-10-01', to: '2026-10-31' };
    expect(statementFileName('BRANCH', period)).toBe(
      'attendance-statement-branch-2026-10-01_2026-10-31.pdf',
    );
    expect(statementFileName('EMPLOYEE', period)).toBe(
      'attendance-statement-employee-2026-10-01_2026-10-31.pdf',
    );
  });

  it('reads the period from the branch timezone, not the device one', () => {
    withClock(() => {
      expect(statementDefaultPeriod('Asia/Kuwait')).toEqual({
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(statementDefaultPeriod('America/New_York')).toEqual({
        from: '2026-09-01',
        to: '2026-09-30',
      });
    });
    expect(statementMonthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(statementMonthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(statementMonthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('refuses a period after the current month or longer than a year', () => {
    withClock(() => {
      const end = statementCurrentMonthEnd('Asia/Kuwait');
      expect(end).toBe('2026-10-31');
      expect(statementPeriodIsValid({ from: '2026-01-01', to: end }, 'Asia/Kuwait')).toBe(true);
      expect(
        statementPeriodIsValid({ from: '2026-01-01', to: '2026-12-31' }, 'Asia/Kuwait'),
      ).toBe(false);
      expect(
        statementPeriodIsValid({ from: '2026-03-01', to: '2026-02-01' }, 'Asia/Kuwait'),
      ).toBe(false);
      expect(
        statementPeriodIsValid({ from: '2024-01-01', to: '2026-01-01' }, 'Asia/Kuwait'),
      ).toBe(false);
    });
  });

  it('lists every month the period touches', () => {
    expect(statementMonthsInPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual(['2026-10']);
    expect(statementMonthsInPeriod({ from: '2026-09-15', to: '2026-11-03' })).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(statementMonthsInPeriod({ from: '2026-11-03', to: '2026-09-15' })).toEqual([]);
  });

  it('maps every refusal code of the slice to its message', () => {
    expect(
      statementErrorMessage({ code: 'ATTENDANCE_STATEMENT_PERIOD_INVALID', status: 422 }, 'en'),
    ).toBe('Choose a valid period of up to 366 days, ending within the current month.');
    expect(
      statementErrorMessage({ code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND', status: 404 }, 'ar'),
    ).toBe('الموظفة مش موجودة أو مفيش ليها بيانات حضور في الفترة دي.');
    expect(statementErrorMessage({ code: 'ATTENDANCE_STATEMENT_RATE_LIMITED', status: 429 }, 'en')).toBe(
      'Too many statement requests. Try again later.',
    );
    expect(statementErrorMessage({ code: 'RENDERER_UNAVAILABLE', status: 503 }, 'en')).toBe(
      'Document rendering is temporarily unavailable. Try again later.',
    );
    expect(statementErrorMessage({ code: 'DOCUMENT_NOT_READY', status: 409 }, 'en')).toBe(
      'The document is not ready yet.',
    );
    expect(statementErrorMessage({ code: 'DOCUMENT_EXPIRED', status: 410 }, 'en')).toBe(
      'The document is no longer available. Request a new one.',
    );
    expect(statementErrorMessage({ status: 401 }, 'en')).toBe(
      'Your session has ended. Sign in again to see the report.',
    );
    expect(statementErrorMessage({ code: 'FEATURE_DISABLED', status: 403 }, 'en')).toBe(
      'Attendance is disabled for this business.',
    );
    expect(statementErrorMessage({ code: 'SOMETHING_ELSE', status: 500 }, 'en')).toBe(
      'Something went wrong. Try again.',
    );
  });

  it('keeps a statement refusal away from the lost-access path', () => {
    expect(statementAccessLost({ code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND', status: 404 })).toBe(
      false,
    );
    expect(statementAccessLost({ code: 'NOT_FOUND', status: 404 })).toBe(true);
    expect(statementAccessLost({ status: 403 })).toBe(true);
    expect(statementAccessLost({ code: 'FEATURE_DISABLED', status: 403 })).toBe(true);
    expect(statementRenderAccessLost({ code: 'NOT_FOUND', status: 404 })).toBe(false);
    expect(statementRenderAccessLost({ status: 403 })).toBe(true);
  });

  it('reads a 404 on the render route as an expired statement', () => {
    expect(statementRenderErrorMessage({ code: 'NOT_FOUND', status: 404 }, 'en')).toBe(
      'The statement expired. Request a new one.',
    );
    expect(statementRenderErrorMessage({ code: 'DOCUMENT_EXPIRED', status: 410 }, 'en')).toBe(
      'The document is no longer available. Request a new one.',
    );
  });

  it('reads every render failure code with its own message', () => {
    expect(statementRenderCodeMessage('STATEMENT_EMPTY', 'en')).toBe(
      'There is no attendance data in this period.',
    );
    expect(statementRenderCodeMessage('DOCUMENT_TOO_LARGE', 'en')).toBe(
      'The statement is too large to generate.',
    );
    expect(statementRenderCodeMessage('DOCUMENT_RENDER_TIMEOUT', 'en')).toBe(
      'Generating the statement took too long.',
    );
    expect(statementRenderCodeMessage('DOCUMENT_RENDER_FAILED', 'en')).toBe(
      'Generating the statement failed.',
    );
    expect(statementRenderCodeMessage('DOCUMENT_KIND_UNKNOWN', 'en')).toBe(
      'This kind of statement is not supported.',
    );
    expect(statementRenderCodeMessage(undefined, 'en')).toBe('Something went wrong. Try again.');
  });

  it('prefers the Arabic employee and branch names in Arabic', () => {
    const employee = {
      employee_id: '01920000-0000-7000-8000-0000000000c2',
      name_ar: 'موظفة اصطناعية',
      name_en: 'Synthetic employee',
      employee_number: 16,
    };
    expect(statementEmployeeName(employee, 'ar')).toBe('موظفة اصطناعية');
    expect(statementEmployeeName(employee, 'en')).toBe('Synthetic employee');
    expect(statementEmployeeName({ ...employee, name_ar: null }, 'ar')).toBe('Synthetic employee');
    const branch = {
      id: '01920000-0000-7000-8000-0000000000a2',
      name_en: 'Synthetic branch',
      name_ar: 'فرع اصطناعي',
      is_active: true,
      effective_timezone: 'Asia/Kuwait',
    };
    expect(statementBranchName(branch, 'ar')).toBe('فرع اصطناعي');
    expect(statementBranchName(branch, 'en')).toBe('Synthetic branch');
  });
});
