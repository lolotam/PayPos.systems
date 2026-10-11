import { expect, it } from 'vitest';
import {
  branchCivilDate,
  initialScheduleWeek,
  newScheduleBreak,
  scheduleBreakValue,
  scheduleFormDefaults,
  newScheduleShift,
} from './schedule-form';
import { setScheduleInput, type ScheduleGrid } from '@pospay/contracts';
it('initialises the Saturday week using the branch timezone at UTC and week boundaries', () => {
  const now = new Date('2026-10-02T22:00:00Z');
  expect(branchCivilDate('Asia/Kuwait', now)).toBe('2026-10-03');
  expect(initialScheduleWeek('Asia/Kuwait', now)).toBe('2026-10-03');
  expect(initialScheduleWeek('America/New_York', now)).toBe('2026-09-26');
  expect(initialScheduleWeek('Asia/Kuwait', new Date('2027-01-01T12:00:00Z'))).toBe('2026-12-26');
});

it.each([
  ['13:00', '14:00'],
  [null, null],
] as const)('round-trips saved breaks %s–%s', (start, end) => {
  const row: ScheduleGrid['items'][number] = {
    employee_id: 'e',
    name_en: 'Synthetic',
    name_ar: null,
    default_shifts: [],
    schedule: {
      id: 's',
      business_id: 'b',
      branch_id: 'b',
      employee_id: 'e',
      week_start: '2026-10-03',
      revision: 1,
      timezone: 'Asia/Kuwait',
      shifts: [
        {
          day: 0,
          start: '09:00',
          end: '17:00',
          working_date: '2026-10-03',
          starts_at: '2026-10-03T06:00:00Z',
          ends_at: '2026-10-03T14:00:00Z',
          break_start: start,
          break_end: end,
          break_starts_at: null,
          break_ends_at: null,
        },
      ],
    },
  };
  const values = scheduleFormDefaults(row, '2026-10-03');
  expect(setScheduleInput.parse(values).shifts[0]).toEqual({
    day: 0,
    start: '09:00',
    end: '17:00',
    break_start: start,
    break_end: end,
  });
});

it('uses only this branch weekday default on the first addition, including its break', () => {
  const defaults = [{ day: 0, start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' }];
  expect(newScheduleShift(0, 0, defaults)).toEqual(defaults[0]);
  expect(newScheduleShift(0, 1, defaults)).toEqual({ day: 0, start: '14:00', end: '18:00' });
  expect(newScheduleShift(1, 0, defaults)).toEqual({ day: 1, start: '09:00', end: '13:00' });
  expect(newScheduleShift(0, 0, [])).toEqual({ day: 0, start: '09:00', end: '13:00' });
  expect(newScheduleShift(0, 0, [{ day: 0, start: '14:00', end: '22:00' }])).toMatchObject({ start: '14:00', end: '22:00' });
});
it('normalizes empty controls and selects an interior break for daytime and overnight shifts', () => {
  for (const value of ['', undefined, null]) expect(scheduleBreakValue(value)).toBeNull();
  expect(newScheduleBreak('09:00', '17:00')).toEqual({ break_start: '13:00', break_end: '14:00' });
  expect(newScheduleBreak('20:00', '04:00')).toEqual({ break_start: '22:40', break_end: '01:20' });
  expect(newScheduleBreak('09:00', '09:03')).toEqual({ break_start: '09:01', break_end: '09:02' });
  expect(newScheduleBreak('09:00', '09:02')).toBeNull();
});
