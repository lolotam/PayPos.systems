import type { AttendanceQrIssue } from '@pospay/contracts';
import { describe, expect, it } from 'vitest';

import { qrPayload, qrRefreshDelay, qrServerTime, receivedQr } from './qr-timing';

const branch = '01920000-0000-7000-8000-000000000001';
const issue: AttendanceQrIssue = {
  token: { branch_id: branch, window: 1, sig: 'ab'.repeat(32) },
  branch: { id: branch, name_ar: null, name_en: 'Test branch', effective_timezone: 'Asia/Kuwait' },
  server_time: '1970-01-01T00:01:00.000Z',
  refresh_at: '1970-01-01T00:02:00.000Z',
  expires_at: '1970-01-01T00:03:00.000Z',
};

describe('server-authoritative QR display timing', () => {
  it('uses server time with conservative request latency despite a wildly skewed client clock', () => {
    const received = receivedQr(issue, 100, 1100, 9_000_000);
    expect(qrServerTime(received, 1100, 9_000_000)).toBe(61_000);
    expect(qrRefreshDelay(received, 1100, 9_000_000)).toBe(59_000);
    expect(qrPayload(received, branch, 1100, 9_000_000)).toBe(JSON.stringify(issue.token));
    expect(qrPayload(received, branch, 60_100, 9_059_000)).toBeNull();
  });

  it('hides on long latency, sleep/resume, backward wall clock and a mismatched branch', () => {
    const received = receivedQr(issue, 0, 1000, 10_000);
    expect(qrPayload(received, branch, 61_000, 1)).toBeNull();
    expect(qrPayload(received, branch, 1000, 100_000)).toBeNull();
    expect(qrPayload(receivedQr(issue, 0, 70_000, 0), branch, 70_000, 0)).toBeNull();
    expect(qrPayload(received, 'other', 1000, 10_000)).toBeNull();
    expect(qrPayload(undefined, branch, 0, 0)).toBeNull();
  });
});
