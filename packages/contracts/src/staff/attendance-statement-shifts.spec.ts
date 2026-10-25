import { expect, it } from 'vitest';

import {
  attendanceStatementShiftOptions,
  attendanceStatementShiftsQuery,
} from './attendance-statement-shifts.js';

it('the shift-options query accepts two employee dates', () => {
  expect(attendanceStatementShiftsQuery.parse({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
    from: '2026-10-01',
    to: '2026-10-31',
  });
});

it('the shift-options query accepts a one-day period', () => {
  expect(
    attendanceStatementShiftsQuery.safeParse({ from: '2026-10-01', to: '2026-10-01' }).success,
  ).toBe(true);
});

it('the shift-options query accepts a 366-day period and refuses a 367-day period', () => {
  expect(
    attendanceStatementShiftsQuery.safeParse({ from: '2026-01-01', to: '2027-01-01' }).success,
  ).toBe(true);
  expect(
    attendanceStatementShiftsQuery.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success,
  ).toBe(false);
});

it('the shift-options query refuses a period whose end is before its start', () => {
  expect(
    attendanceStatementShiftsQuery.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success,
  ).toBe(false);
});

it('the shift-options query refuses an unknown key and an invalid date', () => {
  expect(
    attendanceStatementShiftsQuery.safeParse({
      from: '2026-10-01',
      to: '2026-10-31',
      branch_id: '01920000-0000-7000-8000-0000000000a1',
    }).success,
  ).toBe(false);
  expect(
    attendanceStatementShiftsQuery.safeParse({ from: '2026-02-30', to: '2026-10-31' }).success,
  ).toBe(false);
});

it('the shift options accept distinct HH:MM pairs', () => {
  expect(
    attendanceStatementShiftOptions.parse({
      shifts: [
        { start: '08:00', end: '16:00' },
        { start: '09:00', end: '20:00' },
      ],
    }),
  ).toEqual({
    shifts: [
      { start: '08:00', end: '16:00' },
      { start: '09:00', end: '20:00' },
    ],
  });
});

it('the shift options refuse malformed times and an unknown shift key', () => {
  expect(
    attendanceStatementShiftOptions.safeParse({
      shifts: [{ start: '9:00', end: '20:00' }],
    }).success,
  ).toBe(false);
  expect(
    attendanceStatementShiftOptions.safeParse({
      shifts: [{ start: '09:00', end: '20:00', name: 'Morning' }],
    }).success,
  ).toBe(false);
});
