import { describe, expect, it } from 'vitest';

import { canonicalOpeningHours, planBranchOpeningHoursChange } from '../branch-opening-hours.ts';

const day = (weekday: number, ...intervals: [string, string][]) => ({
  weekday,
  intervals: intervals.map(([opens, closes]) => ({ opens, closes })),
});

describe('canonicalOpeningHours', () => {
  it('ignores the order of days, intervals and object keys', () => {
    const a = [day(2, ['09:00', '12:00'], ['14:00', '18:00']), day(1, ['10:00', '16:00'])];
    const b = [
      { intervals: [{ closes: '16:00', opens: '10:00' }], weekday: 1 },
      day(2, ['14:00', '18:00'], ['09:00', '12:00']),
    ];
    expect(canonicalOpeningHours(a)).toBe(canonicalOpeningHours(b));
  });

  it('keeps null, an empty week and a real week apart', () => {
    const values = [null, [], [day(1, ['09:00', '17:00'])]].map(canonicalOpeningHours);
    expect(new Set(values).size).toBe(3);
  });

  it('compares a legacy non-array shape by its raw text without throwing', () => {
    expect(canonicalOpeningHours({ mon: '9-5' })).toBe('{"mon":"9-5"}');
    expect(canonicalOpeningHours([{ odd: true }, 7])).not.toBe(canonicalOpeningHours([]));
  });
});

describe('planBranchOpeningHoursChange', () => {
  it('changes when an interval, a weekday or the presence differs', () => {
    const stored = [day(1, ['09:00', '17:00'])];
    expect(planBranchOpeningHoursChange(stored, [day(1, ['09:00', '18:00'])])).toBe(true);
    expect(planBranchOpeningHoursChange(stored, [day(2, ['09:00', '17:00'])])).toBe(true);
    expect(planBranchOpeningHoursChange(stored, null)).toBe(true);
    expect(planBranchOpeningHoursChange(null, stored)).toBe(true);
  });

  it('does not change for the same hours written differently, nor for null over null', () => {
    const stored = [day(1, ['09:00', '17:00']), day(3, ['09:00', '17:00'])];
    expect(planBranchOpeningHoursChange(stored, [...stored].reverse())).toBe(false);
    expect(planBranchOpeningHoursChange(null, null)).toBe(false);
  });
});
