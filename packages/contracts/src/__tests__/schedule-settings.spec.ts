import { expect, it } from 'vitest';
import { scheduleSettings, setScheduleSettingsInput } from '../staff/schedule-settings.js';
import { schedulePattern } from '../staff/schedules.js';
it.each([1, 2, 3, 4])('accepts limit %s', (value) => {
  expect(setScheduleSettingsInput.parse({ max_shifts_per_day: value }).max_shifts_per_day).toBe(
    value,
  );
});
it.each([0, 5, 2.5, '3', null])('rejects invalid limit %s', (value) => {
  expect(setScheduleSettingsInput.safeParse({ max_shifts_per_day: value }).success).toBe(false);
});
it('is strict and accepts a default response', () => {
  expect(setScheduleSettingsInput.safeParse({ max_shifts_per_day: 3, extra: true }).success).toBe(
    false,
  );
  expect(
    scheduleSettings.parse({
      business_id: '01920000-0000-7000-8000-000000000101',
      max_shifts_per_day: 3,
      is_default: true,
      updated_at: null,
    }).is_default,
  ).toBe(true);
});
it('bounds weekly patterns at 28', () => {
  const shifts = Array.from({ length: 28 }, (_, i) => ({
    day: i % 7,
    start: '08:00',
    end: '09:00',
  }));
  expect(schedulePattern.safeParse(shifts).success).toBe(true);
  expect(schedulePattern.safeParse([...shifts, shifts[0]]).success).toBe(false);
});
