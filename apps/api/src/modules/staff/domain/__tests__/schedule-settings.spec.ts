import { expect, it } from 'vitest';
import {
  DEFAULT_MAX_SHIFTS_PER_DAY,
  changedPatternDays,
  changedScheduleDays,
  validateMaxShiftsPerDay,
  effectiveMaxShiftsPerDay,
  scheduleSettingsSource,
  templateMaxShiftsPerDay,
} from '../schedule-settings.ts';
import {
  materializeSchedule,
  validateScheduleOverlap,
  validateSchedulePattern,
} from '../schedules.ts';

const pattern = Array.from({ length: 4 }, (_, i) => ({
  day: 5,
  start: `0${i * 2}:00`,
  end: `0${i * 2 + 1}:00`,
}));
const concrete = () => materializeSchedule('2026-10-03', pattern, 'Asia/Kuwait', 4);
it.each([
  [4, 3, 4, 'branch'],
  [null, 2, 2, 'business'],
  [null, null, 3, 'default'],
] as const)('resolves branch %s over business %s', (branch, business, value, source) => {
  expect(effectiveMaxShiftsPerDay(branch, business)).toBe(value);
  expect(scheduleSettingsSource(branch, business)).toBe(source);
});
it('uses the largest active branch value, with business/default fallback only without branches', () => {
  expect(templateMaxShiftsPerDay([2, 4], 3)).toBe(4);
  expect(templateMaxShiftsPerDay([2, 2], 4)).toBe(2);
  expect(templateMaxShiftsPerDay([], 2)).toBe(2);
  expect(templateMaxShiftsPerDay([], null)).toBe(3);
});
it('defaults to three and accepts the four integer settings', () => {
  expect(DEFAULT_MAX_SHIFTS_PER_DAY).toBe(3);
  for (const value of [1, 2, 3, 4]) expect(() => validateMaxShiftsPerDay(value)).not.toThrow();
});
it.each([0, 5, 2.5, NaN, Infinity])('refuses setting %s', (value) => {
  expect(() => validateMaxShiftsPerDay(value)).toThrow('VALIDATION_FAILED');
});
it('compares canonical sets, including additions, removals and instant changes', () => {
  const before = concrete();
  expect(changedScheduleDays(before, [...before].reverse())).toEqual([]);
  expect(
    changedScheduleDays(
      before,
      before.map((s) => ({
        ends_at: s.ends_at,
        starts_at: s.starts_at,
        end: s.end,
        start: s.start,
        working_date: s.working_date,
        day: s.day,
      })),
    ),
  ).toEqual([]);
  expect(changedScheduleDays(before, before.slice(1))).toEqual(['2026-10-08']);
  expect(changedScheduleDays([], before)).toEqual(['2026-10-08']);
  expect(
    changedScheduleDays(
      before,
      before.map((s) => ({ ...s, starts_at: s.starts_at.replace('21:', '20:') })),
    ),
  ).toEqual(['2026-10-08']);
  expect(changedPatternDays(pattern, [...pattern].reverse())).toEqual([]);
  expect(changedPatternDays(pattern, pattern.slice(1))).toEqual([5]);
  expect(changedPatternDays([], pattern)).toEqual([5]);
});
it('treats a break-only edit as an unchanged day, so a lowered limit never blocks it', () => {
  const withBreaks = pattern.map((s) => ({
    ...s,
    break_start: s.start.replace(':00', ':15'),
    break_end: s.start.replace(':00', ':30'),
  }));
  const after = materializeSchedule('2026-10-03', withBreaks, 'Asia/Kuwait', 4);
  expect(after.every((s) => s.break_starts_at !== null)).toBe(true);
  expect(changedScheduleDays(concrete(), after)).toEqual([]);
  expect(changedPatternDays(pattern, withBreaks)).toEqual([]);
});
it.each([1, 3, 4])('checks pattern days at limit %s', (limit) => {
  expect(validateSchedulePattern(pattern.slice(0, limit), limit)).toHaveLength(limit);
  if (limit < 4)
    expect(() => validateSchedulePattern(pattern, limit)).toThrow('SCHEDULE_DAY_LIMIT_EXCEEDED');
});
it('accepts three by default and reports weekday details for a fourth', () => {
  expect(validateSchedulePattern(pattern.slice(0, 3), DEFAULT_MAX_SHIFTS_PER_DAY)).toHaveLength(3);
  expect(() => validateSchedulePattern(pattern, DEFAULT_MAX_SHIFTS_PER_DAY)).toThrow(
    expect.objectContaining({
      code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
      details: { max_shifts_per_day: 3, days: [5] },
    }),
  );
});
it('grandfathers untouched excess days but counts the same branch on changed dates', () => {
  const shifts = concrete();
  expect(() => validateSchedulePattern(pattern, 3, [])).not.toThrow();
  expect(() => validateScheduleOverlap(shifts, [], 3, [], 'branch')).not.toThrow();
  expect(() =>
    validateScheduleOverlap(
      shifts.slice(0, 2),
      shifts.slice(2).map((s) => ({ ...s, branch_id: 'branch' })),
      3,
      undefined,
      'branch',
    ),
  ).toThrow(
    expect.objectContaining({
      code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
      details: { max_shifts_per_day: 3, working_dates: ['2026-10-08'] },
    }),
  );
});
