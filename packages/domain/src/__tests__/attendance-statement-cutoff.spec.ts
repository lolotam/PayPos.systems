import { expect, it } from 'vitest';
import { computeAttendanceMonthlyReport } from '../attendance-monthly-report.js';
import { computeAttendancePeriodReport } from '../attendance-period-report.js';
import type { ReportBranchInputs, ReportContract, ReportLeave, ReportSession, ReportShift } from '../attendance-report-types.js';

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };
const at = (date: string, time: string) => `${date}T${time}:00+03:00`;

function dateRange(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Array.from({ length: (end - start) / 86_400_000 + 1 }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

const contract: ReportContract = { hire_date: '2026-01-01', contract_end: null,
  links: [{ from: '2026-01-01', to: null }],
  entries: Array.from({ length: 7 }, (_, day) => ({ day, start: '09:00', end: '17:00' })) };

function session(date: string, patch: Partial<ReportSession> = {}): ReportSession {
  return { working_date: date, clock_in: at(date, '09:00'), clock_out: at(date, '17:00'), status: 'CLOSED',
    source: 'QR', late_minutes: 0, scheduled_end: null, clock_out_corrected: false, voided: false, ...patch };
}

function shift(date: string, start: string, end: string, nextDate = date): ReportShift {
  return { working_date: date, starts_at: at(date, start), ends_at: at(nextDate, end),
    break_starts_at: null, break_ends_at: null };
}

function noura(last: Partial<ReportSession> = {}, leave: readonly ReportLeave[] = []): ReportBranchInputs {
  const sessions = dateRange('2026-10-01', '2026-10-22').map((date) => session(date));
  sessions.push(session('2026-10-23', { clock_out: at('2026-10-23', '12:00'), ...last }));
  return { timezone: 'Asia/Kuwait', contract, leave_for_branch: leave, shifts: [], sessions };
}

it('FR-013a: a shift that has not ended adds no scheduled minutes', () => {
  const branch: ReportBranchInputs = { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [],
    shifts: [shift('2026-10-23', '17:00', '21:00'), shift('2026-10-23', '08:00', '09:30')], sessions: [] };
  expect(computeAttendancePeriodReport([branch], OCTOBER, at('2026-10-23', '10:00'))).toMatchObject({
    scheduled_minutes: 90,
  });
});

it('BR-12: the default entry of a day counts only once it ends', () => {
  const branch = noura();
  expect(computeAttendancePeriodReport([branch], OCTOBER, at('2026-10-23', '16:59'))).toMatchObject({
    contracted_minutes: 10560,
  });
  expect(computeAttendancePeriodReport([branch], OCTOBER, at('2026-10-23', '17:00'))).toMatchObject({
    contracted_minutes: 11040,
  });
});

it('BR-12: an approved leave shows before the day ends and is subtracted after it', () => {
  const leave: ReportLeave = { id: 'leave-23', type: 'ANNUAL', kind: 'FULL_DAY', from: '2026-10-23',
    to: '2026-10-23', starts_at: at('2026-10-23', '00:00'), ends_at: at('2026-10-24', '00:00') };
  const branch = noura({}, [leave]);
  const early = computeAttendancePeriodReport([branch], OCTOBER, at('2026-10-23', '13:00'));
  expect(early.leave[0]).toEqual({ type: 'ANNUAL', days: 1, partial_minutes: 0 });
  expect(early.contracted_minutes).toBe(10560);
  const late = computeAttendancePeriodReport([branch], OCTOBER, at('2026-10-23', '17:00'));
  expect(late.leave[0]).toEqual({ type: 'ANNUAL', days: 1, partial_minutes: 0 });
  expect(late.contracted_minutes).toBe(10560);
});

it('FR-013a: Noura has 179 worked hours and 176 contracted hours at 13:00, then 184 contracted at 17:00', () => {
  const branch = noura();
  expect(computeAttendancePeriodReport([branch], OCTOBER, at('2026-10-23', '13:00'))).toMatchObject({
    worked_minutes: 10740, contracted_minutes: 10560, difference_minutes: 180,
  });
  expect(computeAttendancePeriodReport([branch], OCTOBER, at('2026-10-23', '17:00'))).toMatchObject({
    worked_minutes: 10740, contracted_minutes: 11040, difference_minutes: -300,
  });
});

it('FR-013a: a late session counts with its lateness while its shift has not ended yet', () => {
  const branch = noura({ clock_in: at('2026-10-23', '09:20'), late_minutes: 20 });
  branch.shifts = [shift('2026-10-23', '09:00', '17:00')];
  const early = computeAttendancePeriodReport([branch], OCTOBER, at('2026-10-23', '13:00'));
  expect(early).toMatchObject({ worked_minutes: 10720, late_count: 1, late_minutes: 20,
    difference_minutes: 160, scheduled_minutes: 0 });
  const late = computeAttendancePeriodReport([branch], OCTOBER, at('2026-10-23', '17:00'));
  expect(late).toMatchObject({ scheduled_minutes: 480, difference_minutes: -320 });
});

it('FR-013a: an overnight shift of 31 October counts only after it ends', () => {
  const branch: ReportBranchInputs = { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [],
    shifts: [shift('2026-10-31', '22:00', '06:00', '2026-11-01')], sessions: [] };
  expect(computeAttendancePeriodReport([branch], OCTOBER, at('2026-11-01', '01:00'))).toMatchObject({
    scheduled_minutes: 0,
  });
  expect(computeAttendancePeriodReport([branch], OCTOBER, at('2026-11-01', '06:00'))).toMatchObject({
    scheduled_minutes: 480,
  });
});

it('FR-013a: an overnight default entry of 31 October counts only after it ends', () => {
  const overnightContract: ReportContract = { ...contract,
    entries: contract.entries.map((entry) => entry.day === 0 ? { day: 0, start: '22:00', end: '06:00' } : entry) };
  const branch: ReportBranchInputs = { timezone: 'Asia/Kuwait', contract: overnightContract, leave_for_branch: [],
    shifts: [], sessions: [] };
  expect(computeAttendancePeriodReport([branch], OCTOBER, at('2026-11-01', '01:00'))).toMatchObject({
    contracted_minutes: 14400,
  });
  expect(computeAttendancePeriodReport([branch], OCTOBER, at('2026-11-01', '06:00')))
    .toEqual(computeAttendanceMonthlyReport([branch], '2026-10'));
});

it('FR-013a: sessions are never cut by the cutoff instant', () => {
  const branch = noura();
  expect(computeAttendancePeriodReport([branch], OCTOBER, at('2026-10-23', '10:00'))).toMatchObject({
    worked_minutes: 10740, days_present: 23,
  });
});
