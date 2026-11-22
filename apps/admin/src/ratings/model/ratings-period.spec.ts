import { describe, expect, it } from 'vitest';

import { currentRatingsMonth, ratingsMonthRange } from './ratings-period';

describe('ratings period', () => {
  it('turns a month into half-open bounds in the branch time zone', () => {
    expect(ratingsMonthRange('2026-10', 'Asia/Kuwait')).toEqual({
      from: '2026-09-30T21:00:00.000Z',
      to: '2026-10-31T21:00:00.000Z',
    });
  });

  it('rolls December into January of the next year', () => {
    expect(ratingsMonthRange('2026-12', 'UTC')).toEqual({
      from: '2026-12-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    });
  });

  it('follows a daylight-saving shift inside the zone', () => {
    expect(ratingsMonthRange('2026-03', 'Europe/Berlin').to).toBe('2026-03-31T22:00:00.000Z');
    expect(ratingsMonthRange('2026-03', 'Europe/Berlin').from).toBe('2026-02-28T23:00:00.000Z');
  });

  it('names the current month by the zone clock, not by UTC', () => {
    const lateInUtc = new Date('2026-10-31T22:30:00.000Z');
    expect(currentRatingsMonth(lateInUtc, 'UTC')).toBe('2026-10');
    expect(currentRatingsMonth(lateInUtc, 'Asia/Kuwait')).toBe('2026-11');
  });
});
