import { describe, expect, it } from 'vitest';

import { currentRatingsMonth, parseRatingsMonth } from './ratings-period';

describe('ratings period', () => {
  it('names the current month by the zone clock, not by UTC', () => {
    const lateInUtc = new Date('2026-10-31T22:30:00.000Z');
    expect(currentRatingsMonth(lateInUtc, 'UTC')).toBe('2026-10');
    expect(currentRatingsMonth(lateInUtc, 'Asia/Kuwait')).toBe('2026-11');
  });
});

describe('ratings month boundaries', () => {
  it.each(['2026-11', '2000-01', '2999-12'])('accepts the complete month %s', (value) => {
    expect(parseRatingsMonth(value)).toBe(value);
  });

  it.each([
    '',
    '2026-',
    '2026-1',
    '2026-13',
    '2026-00',
    'abc',
    '26-11',
    '2026-11-01',
    '1999-12',
    '3000-01',
  ])('rejects the partial or malformed month "%s"', (value) => {
    expect(parseRatingsMonth(value)).toBeNull();
  });
});
