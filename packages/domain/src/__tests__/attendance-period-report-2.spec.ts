import { expect, it } from 'vitest';
import { computeAttendancePeriodReport } from '../attendance-period-report.js';
import type { ReportBranchInputs, ReportContract, ReportSession } from '../attendance-report-types.js';

function dateRange(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Array.from({ length: (end - start) / 86_400_000 + 1 }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

function session(date: string): ReportSession {
  return { working_date: date, clock_in: `${date}T06:00:00Z`, clock_out: `${date}T14:00:00Z`,
    status: 'CLOSED', source: 'QR', late_minutes: 0, scheduled_end: null, clock_out_corrected: false,
    voided: false };
}

function branch(dates: readonly string[], overrides: Partial<ReportContract> = {}): ReportBranchInputs {
  const contract: ReportContract = { hire_date: '2026-01-01', contract_end: null,
    links: [{ from: '2026-01-01', to: null }],
    entries: Array.from({ length: 7 }, (_, day) => ({ day, start: '09:00', end: '17:00' })), ...overrides };
  return { timezone: 'Asia/Kuwait', contract, leave_for_branch: [], shifts: [],
    sessions: dates.map((date) => session(date)) };
}

const october = dateRange('2026-10-01', '2026-10-31');

it('a partial period counts only its own days', () => {
  const row = branch(october);
  const report = computeAttendancePeriodReport([row], { from: '2026-10-10', to: '2026-10-20' }, null);
  expect(report).toMatchObject({ days_present: 11, worked_minutes: 5280, scheduled_minutes: 0,
    contracted_minutes: 5280, difference_minutes: 0, late_count: 0, late_minutes: 0,
    missing_clock_out: 0, manual_days: 0 });
});

it('a period across the year boundary counts both months', () => {
  const dates = [...dateRange('2026-12-20', '2026-12-31'), ...dateRange('2027-01-01', '2027-01-10')];
  const report = computeAttendancePeriodReport([branch(dates)], { from: '2026-12-20', to: '2027-01-10' }, null);
  expect(report).toMatchObject({ days_present: 22, worked_minutes: 10560, contracted_minutes: 10560,
    difference_minutes: 0 });
});

it('a hire date and a contract end inside the period bound the contracted minutes only', () => {
  const row = branch(october, { hire_date: '2026-10-15', contract_end: '2026-10-25' });
  const report = computeAttendancePeriodReport([row], { from: '2026-10-01', to: '2026-10-31' }, null);
  expect(report).toMatchObject({ days_present: 31, worked_minutes: 14880, contracted_minutes: 5280,
    difference_minutes: 9600 });
});

it('AB-Q12: a deletion date inside the period ends the contract there', () => {
  const row = branch(october, { contract_end: '2026-10-20' });
  const report = computeAttendancePeriodReport([row], { from: '2026-10-01', to: '2026-10-31' }, null);
  expect(report).toMatchObject({ worked_minutes: 14880, contracted_minutes: 9600, difference_minutes: 5280 });
});

it('a range equals the sum of its single-day periods', () => {
  const row = branch(october);
  const range = computeAttendancePeriodReport([row], { from: '2026-10-10', to: '2026-10-20' }, null);
  const days = dateRange('2026-10-10', '2026-10-20');
  const sum = days.reduce((total, date) => {
    const day = computeAttendancePeriodReport([row], { from: date, to: date }, null);
    return { worked: total.worked + day.worked_minutes, contracted: total.contracted + day.contracted_minutes };
  }, { worked: 0, contracted: 0 });
  expect(sum).toEqual({ worked: 5280, contracted: 5280 });
  expect(range.worked_minutes).toBe(sum.worked);
  expect(range.contracted_minutes).toBe(sum.contracted);
});

it('a period before the hire date has no contracted minutes and no sessions', () => {
  const row = branch([], { hire_date: '2026-10-15' });
  expect(computeAttendancePeriodReport([row], { from: '2026-10-01', to: '2026-10-10' }, null)).toMatchObject({
    days_present: 0, worked_minutes: 0, contracted_minutes: 0, difference_minutes: 0,
  });
});
