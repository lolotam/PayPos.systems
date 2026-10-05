import { describe, expect, it } from 'vitest';
import {
  businessToday,
  daysUntilExpiry,
  documentExpiryCandidate,
  expiryNoticeWindow,
  recordExpiryOutcome,
} from '../document-expiry.ts';

describe('businessToday', () => {
  it('uses the business timezone, not the server timezone', () => {
    // 2026-10-05T22:30Z هو 2026-10-06 في الكويت (UTC+3) و2026-10-05 في لندن.
    const at = new Date('2026-10-05T22:30:00Z');
    expect(businessToday(at, 'Asia/Kuwait')).toBe('2026-10-06');
    expect(businessToday(at, 'Europe/London')).toBe('2026-10-05');
  });

  it('a timezone behind UTC keeps the previous local day near midnight UTC', () => {
    const at = new Date('2026-10-06T02:00:00Z');
    expect(businessToday(at, 'America/New_York')).toBe('2026-10-05');
  });
});

it('counts only committed notices and tracks retryable failures', () => {
  const progress = { notified: 0, failed: 0 };
  expect(recordExpiryOutcome(progress, false)).toEqual(progress);
  expect(recordExpiryOutcome(progress, true)).toEqual({ notified: 1, failed: 0 });
  expect(recordExpiryOutcome(progress, null)).toEqual({ notified: 0, failed: 1 });
});

it.each([
  ['2026-03-08T04:59:59Z', '2026-03-07'],
  ['2026-03-08T05:00:00Z', '2026-03-08'],
  ['2026-03-08T07:00:00Z', '2026-03-08'],
  ['2026-11-01T05:30:00Z', '2026-11-01'],
  ['2026-11-01T06:30:00Z', '2026-11-01'],
])('counts civil days through DST at %s', (instant, today) => {
  expect(businessToday(new Date(instant), 'America/New_York')).toBe(today);
  expect(documentExpiryCandidate(today, 0, today)).toBe(true);
  expect(expiryNoticeWindow('2026-03-07', 2).to).toBe('2026-03-09');
  expect(expiryNoticeWindow('2026-10-31', 2).to).toBe('2026-11-02');
});

describe('daysUntilExpiry', () => {
  it('counts signed civil days and returns null without an expiry', () => {
    expect(daysUntilExpiry('2026-10-05', '2026-10-05')).toBe(0);
    expect(daysUntilExpiry('2026-10-06', '2026-10-05')).toBe(1);
    expect(daysUntilExpiry('2026-10-04', '2026-10-05')).toBe(-1);
    expect(daysUntilExpiry(null, '2026-10-05')).toBeNull();
  });

  it('rejects impossible dates rather than guessing', () => {
    expect(() => daysUntilExpiry('2026-02-30', '2026-10-05')).toThrow();
    expect(() => daysUntilExpiry('2026-10-05', '2026-13-01')).toThrow();
  });
});

describe('expiryNoticeWindow', () => {
  it('is inclusive on both ends; zero alert days is the expiry day only', () => {
    expect(expiryNoticeWindow('2026-10-05', 0)).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    expect(expiryNoticeWindow('2026-10-05', 30)).toEqual({
      from: '2026-10-05',
      to: '2026-11-04',
    });
  });
});

describe('documentExpiryCandidate', () => {
  it('alert_days 0 fires on the expiry day only, never the day before or after', () => {
    const today = '2026-10-05';
    expect(documentExpiryCandidate('2026-10-05', 0, today)).toBe(true);
    expect(documentExpiryCandidate('2026-10-06', 0, today)).toBe(false);
    expect(documentExpiryCandidate('2026-10-04', 0, today)).toBe(false);
  });

  it('fires across the whole alert window, including its last day', () => {
    const today = '2026-10-05';
    expect(documentExpiryCandidate('2026-11-04', 30, today)).toBe(true);
    expect(documentExpiryCandidate('2026-11-03', 30, today)).toBe(true);
    expect(documentExpiryCandidate('2026-11-05', 30, today)).toBe(false);
  });

  it('ignores a document without an expiry', () => {
    expect(documentExpiryCandidate(null, 30, '2026-10-05')).toBe(false);
    expect(documentExpiryCandidate(null, 0, '2026-10-05')).toBe(false);
  });

  it('never fires for an already expired document, even with a wide window', () => {
    expect(documentExpiryCandidate('2026-10-04', 365, '2026-10-05')).toBe(false);
  });
});
