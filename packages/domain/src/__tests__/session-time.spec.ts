import { describe, expect, it } from 'vitest';

import {
  isLateEntry,
  sessionBusinessDate,
  sessionTime,
  SessionTimeError,
  type SessionTimeErrorCode,
  validateAppendWindow,
} from '../session-time.js';

function expectSessionTimeError(fn: () => unknown, expectedCode: SessionTimeErrorCode) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SessionTimeError);
  expect((caught as SessionTimeError).code).toBe(expectedCode);
}

describe('previous-month floor and January rollover (FR-014/FR-016)', () => {
  it.each([
    ['2026-09-01', '2026-10-15T12:00:00Z', 'Asia/Kuwait', 'first day of previous month accepted'],
    ['2026-09-30', '2026-10-15T12:00:00Z', 'Asia/Kuwait', 'last day of previous month accepted'],
    ['2026-10-01', '2026-10-15T12:00:00Z', 'Asia/Kuwait', 'current month date accepted'],
    ['2025-12-01', '2026-01-15T12:00:00Z', 'Asia/Kuwait', 'first day of December from January accepted'],
    ['2025-12-31', '2026-01-01T08:00:00Z', 'Asia/Kuwait', 'end of December from January accepted'],
  ])('accepts %s when recorded at %s (%s)', (businessDate, recordedAtIso, timezone) => {
    const recordedAt = new Date(recordedAtIso);
    expect(() => validateAppendWindow(businessDate, recordedAt, timezone)).not.toThrow();
  });

  it.each([
    ['2026-08-31', '2026-10-15T12:00:00Z', 'Asia/Kuwait', 'day before previous month floor refused'],
    ['2026-05-10', '2026-10-15T12:00:00Z', 'Asia/Kuwait', 'older month refused'],
    ['2025-11-30', '2026-01-15T12:00:00Z', 'Asia/Kuwait', 'day before December fallback in January refused'],
    ['2024-12-31', '2026-01-15T12:00:00Z', 'Asia/Kuwait', 'two years prior in January refused'],
  ])('refuses %s when recorded at %s with SESSION_TIME_TOO_OLD (%s)', (businessDate, recordedAtIso, timezone) => {
    const recordedAt = new Date(recordedAtIso);
    expectSessionTimeError(
      () => validateAppendWindow(businessDate, recordedAt, timezone),
      'SESSION_TIME_TOO_OLD',
    );
  });

  it('sessionTime enforces previous-month floor on occurred_at input', () => {
    const recordedAt = new Date('2026-10-15T12:00:00Z');
    const validOccurred = new Date('2026-09-01T10:00:00Z');
    const tooOldOccurred = new Date('2026-08-31T20:00:00Z'); // in Kuwait: 2026-08-31 23:00

    expect(() => sessionTime(validOccurred, recordedAt, 'Asia/Kuwait')).not.toThrow();
    expectSessionTimeError(
      () => sessionTime(tooOldOccurred, recordedAt, 'Asia/Kuwait'),
      'SESSION_TIME_TOO_OLD',
    );
  });
});

describe('120s future allowance', () => {
  const recordedAt = new Date('2026-10-15T12:00:00.000Z');
  const timezone = 'Asia/Kuwait';

  it.each([
    [0, 'exact instant matches recordedAt'],
    [1, '1 ms ahead'],
    [60_000, '60 seconds ahead'],
    [120_000, 'exact 120,000 ms limit'],
  ])('accepts occurredAt offset +%d ms (%s)', (offsetMs) => {
    const occurredAt = new Date(recordedAt.getTime() + offsetMs);
    const result = sessionTime(occurredAt, recordedAt, timezone);
    // visitInstant clamps future instants within allowance back to recordedAt
    expect(result.occurred_at).toEqual(recordedAt);
    expect(result.business_date).toBe('2026-10-15');
  });

  it.each([
    [120_001, '1 ms beyond 120s allowance'],
    [121_000, '1 second beyond allowance'],
    [300_000, '5 minutes into the future'],
  ])('refuses occurredAt offset +%d ms with SESSION_TIME_IN_FUTURE (%s)', (offsetMs) => {
    const occurredAt = new Date(recordedAt.getTime() + offsetMs);
    expectSessionTimeError(
      () => sessionTime(occurredAt, recordedAt, timezone),
      'SESSION_TIME_IN_FUTURE',
    );
  });
});

describe('timezone day change: Asia/Kuwait vs UTC at 21:00Z', () => {
  it.each([
    ['2026-10-15T21:00:00.000Z', 'UTC', '2026-10-15', '21:00Z is same date in UTC'],
    ['2026-10-15T21:00:00.000Z', 'Asia/Kuwait', '2026-10-16', '21:00Z is midnight next day in Kuwait (UTC+3)'],
    ['2026-10-15T20:59:59.999Z', 'UTC', '2026-10-15', '20:59:59Z is same date in UTC'],
    ['2026-10-15T20:59:59.999Z', 'Asia/Kuwait', '2026-10-15', '20:59:59Z is 23:59:59 same day in Kuwait'],
    ['2026-10-15T21:00:01.000Z', 'Asia/Kuwait', '2026-10-16', '21:00:01Z is past midnight in Kuwait'],
  ])('sessionBusinessDate(%s, %s) resolves to %s (%s)', (instantIso, tz, expectedDate) => {
    const instant = new Date(instantIso);
    expect(sessionBusinessDate(instant, tz)).toBe(expectedDate);
  });

  it('sessionTime computes business_date and late based on branch timezone', () => {
    const recordedAt = new Date('2026-10-15T21:05:00.000Z');
    // In UTC, recordedAt is 2026-10-15. In Kuwait, recordedAt is 2026-10-16.
    const resUtc = sessionTime(recordedAt, recordedAt, 'UTC');
    expect(resUtc.business_date).toBe('2026-10-15');
    expect(resUtc.late).toBe(false);

    const resKuwait = sessionTime(recordedAt, recordedAt, 'Asia/Kuwait');
    expect(resKuwait.business_date).toBe('2026-10-16');
    expect(resKuwait.late).toBe(false);
  });
});

describe('late flag determination (isLateEntry and sessionTime)', () => {
  it.each([
    ['2026-10-14', '2026-10-15', true, 'previous day is late'],
    ['2026-09-15', '2026-10-15', true, 'previous month is late'],
    ['2026-10-15', '2026-10-15', false, 'same calendar day is not late'],
    ['2026-10-16', '2026-10-15', false, 'future day is not late'],
  ])('isLateEntry(%s, %s) returns %s (%s)', (occurredDate, recordedDate, expectedLate) => {
    expect(isLateEntry(occurredDate, recordedDate)).toBe(expectedLate);
  });

  it('sessionTime sets late=false for earlier time on the same business day', () => {
    const recordedAt = new Date('2026-10-15T18:00:00.000Z');
    const earlierSameDay = new Date('2026-10-15T09:00:00.000Z');
    const result = sessionTime(earlierSameDay, recordedAt, 'Asia/Kuwait');
    expect(result.late).toBe(false);
    expect(result.business_date).toBe('2026-10-15');
  });

  it('sessionTime sets late=true when occurred_at was on a previous business day', () => {
    const recordedAt = new Date('2026-10-15T12:00:00.000Z');
    const previousDay = new Date('2026-10-14T12:00:00.000Z');
    const result = sessionTime(previousDay, recordedAt, 'Asia/Kuwait');
    expect(result.late).toBe(true);
    expect(result.business_date).toBe('2026-10-14');
  });

  it('sessionTime with undefined occurredAt defaults to recordedAt with late=false', () => {
    const recordedAt = new Date('2026-10-15T12:00:00.000Z');
    const result = sessionTime(undefined, recordedAt, 'Asia/Kuwait');
    expect(result.occurred_at).toEqual(recordedAt);
    expect(result.business_date).toBe('2026-10-15');
    expect(result.late).toBe(false);
  });
});

describe('invalid date inputs', () => {
  it.each([
    [new Date(NaN), new Date(), 'invalid occurredAt'],
    [new Date(), new Date(NaN), 'invalid recordedAt'],
  ])('rejects non-finite dates with SESSION_TIME_INVALID (%s)', (occurred, recorded) => {
    expectSessionTimeError(
      () => sessionTime(occurred, recorded, 'Asia/Kuwait'),
      'SESSION_TIME_INVALID',
    );
  });

  it('rejects invalid timezone identifier with SESSION_TIME_INVALID', () => {
    const now = new Date();
    expectSessionTimeError(
      () => sessionBusinessDate(now, 'Invalid/Timezone_Name'),
      'SESSION_TIME_INVALID',
    );
  });
});
