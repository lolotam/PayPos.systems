import { expect, it } from 'vitest';
import {
  DEFAULT_MAX_SHIFTS_PER_DAY,
  changedPatternDays,
  changedScheduleDays,
  validateMaxShiftsPerDay,
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
it('grandfathers untouched excess days but counts other branches on changed dates', () => {
  const shifts = concrete();
  expect(() => validateSchedulePattern(pattern, 3, [])).not.toThrow();
  expect(() => validateScheduleOverlap(shifts, [], 3, [])).not.toThrow();
  expect(() => validateScheduleOverlap(shifts.slice(0, 2), shifts.slice(2), 3)).toThrow(
    expect.objectContaining({
      code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
      details: { max_shifts_per_day: 3, working_dates: ['2026-10-08'] },
    }),
  );
});
