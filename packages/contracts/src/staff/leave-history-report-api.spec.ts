import { describe, expect, it } from 'vitest';
import {
  leaveHistoryReportAccepted,
  leaveHistoryReportCursorData,
  leaveHistoryReportRequest,
  leaveHistoryReportResultQuery,
  leaveHistoryReportStatus,
} from './leave-history-report-api.js';
import { LEAVE_HISTORY_REPORT_ROW_CAP } from './leave-history-report-job.js';

describe('leaveHistoryReportRequest', () => {
  it('applies defaults for types and statuses arrays', () => {
    const parsed = leaveHistoryReportRequest.parse({
      from: '2026-01-01',
      to: '2026-06-30',
    });
    expect(parsed['types[]']).toEqual([]);
    expect(parsed['statuses[]']).toEqual([]);
  });

  it('strictly rejects forbidden keys like employee_id, cursor, and limit', () => {
    const forbidden = [
      { employee_id: '01931f6c-8594-7b9e-b9b5-f37751c8f1a1' },
      { cursor: 'any-cursor' },
      { limit: 20 },
      { unknown_flag: true },
    ];
    for (const extra of forbidden) {
      const res = leaveHistoryReportRequest.safeParse({
        from: '2026-01-01',
        to: '2026-06-30',
        ...extra,
      });
      expect(res.success).toBe(false);
    }
  });

  it('refuses inverted date ranges and spans exceeding 365 civil days', () => {
    const inverted = leaveHistoryReportRequest.safeParse({
      from: '2026-10-01',
      to: '2026-09-01',
    });
    expect(inverted.success).toBe(false);
    expect(inverted.error?.issues[0]?.message).toBe('LEAVE_HISTORY_RANGE_INVALID');

    const oversized = leaveHistoryReportRequest.safeParse({
      from: '2026-01-01',
      to: '2027-01-03',
    });
    expect(oversized.success).toBe(false);
    expect(oversized.error?.issues[0]?.message).toBe('LEAVE_HISTORY_RANGE_INVALID');

    const valid365 = leaveHistoryReportRequest.safeParse({
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(valid365.success).toBe(true);
  });
});

describe('leaveHistoryReportAccepted', () => {
  it('parses report_id and rejects a non-UUID', () => {
    const valid = leaveHistoryReportAccepted.safeParse({
      report_id: '01931f6c-8594-7b9e-b9b5-f37751c8f1a1',
    });
    expect(valid.success).toBe(true);

    const invalid = leaveHistoryReportAccepted.safeParse({
      report_id: 'not-a-uuid',
    });
    expect(invalid.success).toBe(false);
  });
});

describe('leaveHistoryReportStatus union', () => {
  it('parses pending status', () => {
    const res = leaveHistoryReportStatus.safeParse({ status: 'pending' });
    expect(res.success).toBe(true);
  });

  it('parses failed status for both failure codes and requires bilingual messages', () => {
    const failed = leaveHistoryReportStatus.safeParse({
      status: 'failed',
      error: {
        code: 'LEAVE_HISTORY_REPORT_FAILED',
        message_ar: 'فشلت معالجة التقرير',
        message_en: 'Report processing failed',
      },
    });
    expect(failed.success).toBe(true);

    const tooLarge = leaveHistoryReportStatus.safeParse({
      status: 'failed',
      error: {
        code: 'LEAVE_HISTORY_REPORT_TOO_LARGE',
        message_ar: 'حجم التقرير تجاوز الحد المسموح',
        message_en: 'Report size exceeded allowable limit',
      },
    });
    expect(tooLarge.success).toBe(true);

    const badCode = leaveHistoryReportStatus.safeParse({
      status: 'failed',
      error: {
        code: 'UNKNOWN_ERROR',
        message_ar: 'غير معروف',
        message_en: 'Unknown',
      },
    });
    expect(badCode.success).toBe(false);

    const missingEn = leaveHistoryReportStatus.safeParse({
      status: 'failed',
      error: {
        code: 'LEAVE_HISTORY_REPORT_FAILED',
        message_ar: 'رسالة عربية',
      },
    });
    expect(missingEn.success).toBe(false);
  });

  it('parses ready status with full LeaveHistoryPage fields and computed_at', () => {
    const ready = leaveHistoryReportStatus.safeParse({
      status: 'ready',
      computed_at: '2026-11-07T10:05:00.000Z',
      as_of: '2026-11-07T10:00:00.000Z',
      items: [],
      next_cursor: null,
      last_taken: null,
      request_branch_ids: [],
      absence_branch_ids: [],
    });
    expect(ready.success).toBe(true);
  });
});

describe('leaveHistoryReportCursorData bounds', () => {
  const report_id = '01931f6c-8594-7b9e-b9b5-f37751c8f1a1';

  it('accepts boundary values seq 0 and seq 25,000', () => {
    expect(leaveHistoryReportCursorData.safeParse({ report_id, seq: 0 }).success).toBe(true);
    expect(
      leaveHistoryReportCursorData.safeParse({ report_id, seq: LEAVE_HISTORY_REPORT_ROW_CAP }).success,
    ).toBe(true);
  });

  it('refuses negative seq, fractional seq, and seq beyond 25,000', () => {
    expect(leaveHistoryReportCursorData.safeParse({ report_id, seq: -1 }).success).toBe(false);
    expect(leaveHistoryReportCursorData.safeParse({ report_id, seq: 1.5 }).success).toBe(false);
    expect(
      leaveHistoryReportCursorData.safeParse({ report_id, seq: LEAVE_HISTORY_REPORT_ROW_CAP + 1 })
        .success,
    ).toBe(false);
  });
});

describe('leaveHistoryReportResultQuery', () => {
  it('defaults limit to 50 and coerces numeric string', () => {
    const def = leaveHistoryReportResultQuery.parse({});
    expect(def.limit).toBe(50);

    const coerced = leaveHistoryReportResultQuery.parse({ limit: '20' });
    expect(coerced.limit).toBe(20);
  });

  it('enforces limit range [1, 100]', () => {
    expect(leaveHistoryReportResultQuery.safeParse({ limit: 1 }).success).toBe(true);
    expect(leaveHistoryReportResultQuery.safeParse({ limit: 100 }).success).toBe(true);
    expect(leaveHistoryReportResultQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(leaveHistoryReportResultQuery.safeParse({ limit: 101 }).success).toBe(false);
  });
});
