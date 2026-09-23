import { describe, expect, it } from 'vitest';

import { openingHours } from '../tenancy/opening-hours.js';

const day = (weekday: number, ...intervals: [string, string][]) => ({
  weekday,
  intervals: intervals.map(([opens, closes]) => ({ opens, closes })),
});

const valid = (value: unknown): boolean => openingHours.safeParse(value).success;

describe('openingHours — intervals per weekday (ISO 1 = Monday … 7 = Sunday)', () => {
  it('accepts a split day and a day that crosses midnight', () => {
    expect(
      valid([day(1, ['09:00', '13:00'], ['16:00', '23:00']), day(5, ['18:00', '02:00'])]),
    ).toBe(true);
  });

  it('accepts no days at all — the branch is closed every day', () => {
    expect(valid([])).toBe(true);
  });

  it('accepts intervals that touch without overlapping', () => {
    expect(valid([day(2, ['09:00', '13:00'], ['13:00', '17:00'])])).toBe(true);
  });

  it('rejects overlapping intervals on the same day', () => {
    expect(valid([day(3, ['09:00', '14:00'], ['13:00', '17:00'])])).toBe(false);
  });

  it('rejects a long interval that covers a later, non-adjacent one', () => {
    expect(valid([day(3, ['08:00', '20:00'], ['09:00', '10:00'], ['11:00', '12:00'])])).toBe(false);
  });

  it('rejects an overnight interval that runs into the next morning', () => {
    expect(valid([day(4, ['20:00', '03:00']), day(5, ['02:00', '10:00'])])).toBe(false);
  });

  it("rejects Sunday night running into Monday's opening (the week wraps)", () => {
    expect(valid([day(7, ['22:00', '04:00']), day(1, ['03:00', '09:00'])])).toBe(false);
  });

  it('rejects the same weekday twice', () => {
    expect(valid([day(1, ['09:00', '12:00']), day(1, ['14:00', '18:00'])])).toBe(false);
  });

  it.each([
    ['opens equals closes', [day(1, ['09:00', '09:00'])]],
    ['24:00 is not a valid clock', [day(1, ['09:00', '24:00'])]],
    ['weekday 0', [day(0, ['09:00', '12:00'])]],
    ['weekday 8', [day(8, ['09:00', '12:00'])]],
    ['a day with no intervals', [day(1)]],
  ])('rejects %s', (_label, value) => {
    expect(valid(value)).toBe(false);
  });
});
