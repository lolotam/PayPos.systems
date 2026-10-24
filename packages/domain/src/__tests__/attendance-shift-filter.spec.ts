import { expect, it } from 'vitest';
import { computeAttendanceShiftPeriodReport } from '../attendance-shift-filter.js';
import { hasAttendanceStatementCoverage } from '../attendance-statement-coverage.js';
import type { ReportBranchInputs, ReportLeave, ReportSession, ReportShift } from '../attendance-report-types.js';

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
const PAIR = { start: '09:00', end: '20:00' };
const at = (date: string, time: string) => `${date}T${time}:00+03:00`;

function dateRange(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Array.from({ length: (end - start) / 86_400_000 + 1 }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

function shift(date: string, start: string, end: string, nextDate = date): ReportShift {
  return { working_date: date, starts_at: at(date, start), ends_at: at(nextDate, end),
    break_starts_at: null, break_ends_at: null };
}

function session(date: string, start: string, end: string, scheduledEnd: string | null, date2 = date): ReportSession {
  return { working_date: date, clock_in: at(date, start), clock_out: at(date2, end), status: 'CLOSED',
    source: 'QR', late_minutes: 0, scheduled_end: scheduledEnd, clock_out_corrected: false, voided: false };
}

function fullDays(pick: (date: string) => { start: string; end: string }): ReportBranchInputs {
  const dates = dateRange('2026-10-01', '2026-10-31');
  return { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [],
    shifts: dates.map((date) => { const pair = pick(date); return shift(date, pair.start, pair.end); }),
    sessions: dates.map((date) => { const pair = pick(date);
      return session(date, pair.start, pair.end, at(date, pair.end)); }) };
}

const sara = () => fullDays(() => ({ start: '09:00', end: '20:00' }));
const heba = () => fullDays(() => ({ start: '08:00', end: '16:00' }));
const reemLeave: ReportLeave[] = [
  { id: 'sick-14', type: 'SICK', kind: 'FULL_DAY', from: '2026-10-14', to: '2026-10-14',
    starts_at: at('2026-10-14', '00:00'), ends_at: at('2026-10-15', '00:00') },
  { id: 'annual-20', type: 'ANNUAL', kind: 'FULL_DAY', from: '2026-10-20', to: '2026-10-20',
    starts_at: at('2026-10-20', '00:00'), ends_at: at('2026-10-21', '00:00') },
];
function reem(): ReportBranchInputs {
  const pick = (date: string) => date <= '2026-10-14' ? { start: '09:00', end: '20:00' } : { start: '08:00', end: '16:00' };
  return { ...fullDays(pick), leave_for_branch: reemLeave };
}

it('BR-11: the filtered statement keeps every day of the employee scheduled on the pair', () => {
  const report = computeAttendanceShiftPeriodReport([sara()], OCTOBER, null, PAIR);
  expect(report).toMatchObject({ days_present: 31, worked_minutes: 20460, scheduled_minutes: 20460,
    contracted_minutes: null, difference_minutes: null, late_count: 0, late_minutes: 0,
    missing_clock_out: 0, manual_days: 0 });
});

it('BR-11: an employee scheduled only on another pair has no figures and no coverage', () => {
  const branch = heba();
  expect(computeAttendanceShiftPeriodReport([branch], OCTOBER, null, PAIR)).toMatchObject({
    days_present: 0, worked_minutes: 0, scheduled_minutes: 0,
  });
  expect(hasAttendanceStatementCoverage(branch, OCTOBER, at('2026-10-31', '12:00'), PAIR)).toBe(false);
});

it('BR-11 and ST-Q7: only the days on the pair count, and the leave follows them', () => {
  const report = computeAttendanceShiftPeriodReport([reem()], OCTOBER, null, PAIR);
  expect(report).toMatchObject({ days_present: 14, worked_minutes: 9240, scheduled_minutes: 9240,
    contracted_minutes: null, difference_minutes: null });
  expect(report.leave).toEqual([
    { type: 'ANNUAL', days: 0, partial_minutes: 0 },
    { type: 'SICK', days: 1, partial_minutes: 0 },
    { type: 'UNPAID', days: 0, partial_minutes: 0 },
    { type: 'OTHER', days: 0, partial_minutes: 0 },
  ]);
});

it('FR-013: a split-shift day keeps only the sessions of the picked shift', () => {
  const branch: ReportBranchInputs = { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [],
    shifts: [shift('2026-10-20', '09:00', '13:00'), shift('2026-10-20', '17:00', '21:00')],
    sessions: [session('2026-10-20', '09:00', '13:00', at('2026-10-20', '13:00')),
      session('2026-10-20', '17:00', '21:00', at('2026-10-20', '21:00'))] };
  const report = computeAttendanceShiftPeriodReport([branch], OCTOBER, null, { start: '17:00', end: '21:00' });
  expect(report).toMatchObject({ days_present: 1, worked_minutes: 240, scheduled_minutes: 240 });
});

it('BW-Q8: an overnight pair keeps the break credit on the clock-in date', () => {
  const ends = at('2026-10-21', '06:00');
  const branch: ReportBranchInputs = { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [],
    shifts: [{ working_date: '2026-10-20', starts_at: at('2026-10-20', '22:00'), ends_at: ends,
      break_starts_at: at('2026-10-21', '00:00'), break_ends_at: at('2026-10-21', '01:00') }],
    sessions: [session('2026-10-20', '22:00', '00:30', ends, '2026-10-21'),
      session('2026-10-21', '01:00', '06:00', ends)] };
  const report = computeAttendanceShiftPeriodReport([branch], OCTOBER, null, { start: '22:00', end: '06:00' });
  expect(report).toMatchObject({ days_present: 2, worked_minutes: 480, scheduled_minutes: 480 });
});

it('FR-013: a session with no scheduled end belongs to no shift and is left out', () => {
  const branch: ReportBranchInputs = { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [],
    shifts: [shift('2026-10-20', '09:00', '17:00')],
    sessions: [session('2026-10-20', '09:00', '17:00', null)] };
  expect(computeAttendanceShiftPeriodReport([branch], OCTOBER, null, { start: '09:00', end: '17:00' }))
    .toMatchObject({ days_present: 0, worked_minutes: 0, scheduled_minutes: 480 });
});

it('the same instant written in UTC and in Kuwait time matches the same pair', () => {
  const branch: ReportBranchInputs = { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [],
    shifts: [{ working_date: '2026-10-20', starts_at: '2026-10-20T06:00:00Z', ends_at: '2026-10-20T13:00:00Z',
      break_starts_at: null, break_ends_at: null }],
    sessions: [session('2026-10-20', '09:00', '16:00', '2026-10-20T13:00:00Z')] };
  expect(computeAttendanceShiftPeriodReport([branch], OCTOBER, null, { start: '09:00', end: '16:00' }))
    .toMatchObject({ days_present: 1, worked_minutes: 420 });
});

it('the pair read from the request row time columns matches the same days', () => {
  const fromRow = computeAttendanceShiftPeriodReport([sara()], OCTOBER, null, { start: '09:00:00', end: '20:00:00' });
  expect(fromRow).toEqual(computeAttendanceShiftPeriodReport([sara()], OCTOBER, null, PAIR));
  expect(fromRow).toMatchObject({ days_present: 31, worked_minutes: 20460 });
});

it('a pair that matches nothing gives zero figures and no coverage', () => {
  const branch = sara();
  expect(computeAttendanceShiftPeriodReport([branch], OCTOBER, null, { start: '12:00', end: '13:00' }))
    .toMatchObject({ days_present: 0, worked_minutes: 0, scheduled_minutes: 0 });
  expect(hasAttendanceStatementCoverage(branch, OCTOBER, at('2026-10-31', '12:00'), { start: '12:00', end: '13:00' }))
    .toBe(false);
});
