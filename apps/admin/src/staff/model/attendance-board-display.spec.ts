import { describe, expect, it } from 'vitest';
import { t } from '@pospay/i18n';
import { boardAccessLost, boardError } from './attendance-board-display';
import { attendanceReportError } from './attendance-report-display';

describe('attendance access loss', () => {
  it('treats an expired session (401) as lost access so cached attendance is hidden', () => {
    expect(boardAccessLost({ status: 401 })).toBe(true);
    expect(boardAccessLost({ status: 403 })).toBe(true);
    expect(boardAccessLost({ status: 500 })).toBe(false);
    expect(boardAccessLost(null)).toBe(false);
  });
  it('tells the reader to sign in again after a 401', () => {
    expect(boardError({ status: 401 }, 'en')).toBe(t('en', 'attendanceBoard.sessionExpired'));
    expect(attendanceReportError({ status: 401 }, 'ar')).toBe(t('ar', 'attendanceReport.sessionExpired'));
  });
});
