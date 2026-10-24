import { expect, it } from 'vitest';
import { computeAttendanceMonthlyReport } from '../attendance-monthly-report.js';
import { computeAttendancePeriodReport } from '../attendance-period-report.js';
import type { ReportBranchInputs, ReportContract, ReportLeave, ReportSession } from '../attendance-report-types.js';

const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };

function overnight(date = '2026-10-03', nextDate = '2026-10-04', out = '00:30', back = '01:00'): ReportBranchInputs {
  const at = (day: string, time: string) => `${day}T${time}:00+03:00`;
  const ends_at = at(nextDate, '04:00');
  const common = { status: 'CLOSED', source: 'QR', late_minutes: 0, scheduled_end: ends_at,
    clock_out_corrected: false, voided: false } as const;
  return { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [],
    shifts: [{ working_date: date, starts_at: at(date, '20:00'), ends_at,
      break_starts_at: at(nextDate, '00:00'), break_ends_at: at(nextDate, '01:00') }],
    sessions: [
      { ...common, working_date: date, clock_in: at(date, '20:00'), clock_out: at(nextDate, out) },
      { ...common, working_date: nextDate, clock_in: at(nextDate, back), clock_out: ends_at },
    ] };
}

const contract: ReportContract = { hire_date: '2026-01-01', contract_end: null, links: [],
  entries: Array.from({ length: 7 }, (_, day) => ({ day, start: '09:00', end: '17:00' })) };
function leave(date: string): ReportLeave {
  return { id: 'synthetic-leave', type: 'ANNUAL', kind: 'FULL_DAY', from: date, to: date,
    starts_at: `${date}T07:00:00Z`, ends_at: `${date}T09:00:00Z` };
}
function branch(links: ReportContract['links'], leaves: readonly ReportLeave[]): ReportBranchInputs {
  return { timezone: 'Asia/Kuwait', sessions: [], shifts: [], contract: { ...contract, links },
    leave_for_branch: leaves };
}
function movingBranches(leaves: readonly ReportLeave[]) {
  return [branch([{ from: '2026-01-01', to: '2026-10-15' }], leaves),
    branch([{ from: '2026-10-15', to: null }], leaves.map((entry) => ({ ...entry })))];
}

function session(patch: Partial<ReportSession> & { working_date: string }): ReportSession {
  return { clock_in: `${patch.working_date}T06:00:00Z`, clock_out: `${patch.working_date}T14:00:00Z`,
    status: 'CLOSED', source: 'QR', late_minutes: 0, scheduled_end: null, clock_out_corrected: false,
    voided: false, ...patch };
}

it('BW-Q8: the overnight break gives the same numbers as the monthly report', () => {
  const branch = overnight();
  expect(computeAttendancePeriodReport([branch], OCTOBER, null)).toEqual(computeAttendanceMonthlyReport([branch], '2026-10'));
  expect(computeAttendancePeriodReport([branch], OCTOBER, null)).toMatchObject({
    days_present: 2, worked_minutes: 480, scheduled_minutes: 480, contracted_minutes: 0,
    difference_minutes: 480, late_count: 0, late_minutes: 0, missing_clock_out: 0, manual_days: 0,
  });
});

it('the October 31 overnight keeps its break credit in October and gives the return session to November', () => {
  const branch = overnight('2026-10-31', '2026-11-01');
  expect(computeAttendancePeriodReport([branch], OCTOBER, null)).toEqual(computeAttendanceMonthlyReport([branch], '2026-10'));
  expect(computeAttendancePeriodReport([branch], OCTOBER, null)).toMatchObject({
    worked_minutes: 300, scheduled_minutes: 480, days_present: 1,
  });
  expect(computeAttendancePeriodReport([branch], { from: '2026-11-01', to: '2026-11-30' }, null)).toMatchObject({
    worked_minutes: 180, scheduled_minutes: 0, days_present: 1,
  });
});

it('AB-Q11: a branch move with leave gives the same numbers as the monthly report', () => {
  const branches = movingBranches([leave('2026-10-10')]);
  expect(computeAttendancePeriodReport(branches, OCTOBER, null)).toEqual(computeAttendanceMonthlyReport(branches, '2026-10'));
  expect(computeAttendancePeriodReport(branches, OCTOBER, null)).toMatchObject({
    days_present: 0, worked_minutes: 0, scheduled_minutes: 0, contracted_minutes: 14400,
    difference_minutes: -14400, late_count: 0, late_minutes: 0, missing_clock_out: 0, manual_days: 0,
  });
  expect(computeAttendancePeriodReport(branches, OCTOBER, null).leave).toEqual([
    { type: 'ANNUAL', days: 1, partial_minutes: 0 },
    { type: 'SICK', days: 0, partial_minutes: 0 },
    { type: 'UNPAID', days: 0, partial_minutes: 0 },
    { type: 'OTHER', days: 0, partial_minutes: 0 },
  ]);
});

it('AB-Q6: a missed clock-out adds nothing until it is corrected', () => {
  const branch: ReportBranchInputs = { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [], shifts: [],
    sessions: [session({ working_date: '2026-10-05' }), session({ working_date: '2026-10-06', status: 'MISSED_OUT' }),
      session({ working_date: '2026-10-07', source: 'MANUAL', late_minutes: 20,
        clock_in: '2026-10-07T06:20:00Z', clock_out: '2026-10-07T09:00:00Z' })] };
  const report = computeAttendancePeriodReport([branch], OCTOBER, null);
  expect(report).toEqual(computeAttendanceMonthlyReport([branch], '2026-10'));
  expect(report).toMatchObject({ days_present: 2, worked_minutes: 640, scheduled_minutes: 0,
    contracted_minutes: 0, difference_minutes: 640, late_count: 1, late_minutes: 20,
    missing_clock_out: 1, manual_days: 1 });
  const corrected = { ...branch, sessions: branch.sessions.map((entry) => entry.status === 'MISSED_OUT'
    ? { ...entry, clock_out_corrected: true } : entry) };
  expect(computeAttendancePeriodReport([corrected], OCTOBER, null)).toMatchObject({
    days_present: 3, worked_minutes: 1120, difference_minutes: 1120, missing_clock_out: 0, manual_days: 1,
  });
});
