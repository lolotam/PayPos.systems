import { expect, it } from 'vitest';
import { hasAttendanceStatementCoverage } from '../attendance-statement-coverage.js';
import type { ReportBranchInputs, ReportContract, ReportLeave, ReportSession, ReportShift } from '../attendance-report-types.js';

const PERIOD = { from: '2026-10-01', to: '2026-10-31' };
const PAIR = { start: '09:00', end: '20:00' };
const CUTOFF = '2026-10-23T12:00:00+03:00';
const at = (date: string, time: string) => `${date}T${time}:00+03:00`;

const contract: ReportContract = { hire_date: '2026-01-01', contract_end: null,
  links: [{ from: '2026-01-01', to: null }],
  entries: Array.from({ length: 7 }, (_, day) => ({ day, start: '09:00', end: '17:00' })) };

function branch(patch: Partial<ReportBranchInputs> = {}): ReportBranchInputs {
  return { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [], shifts: [], sessions: [], ...patch };
}

function session(patch: Partial<ReportSession> = {}): ReportSession {
  return { working_date: '2026-10-05', clock_in: at('2026-10-05', '09:00'), clock_out: at('2026-10-05', '17:00'),
    status: 'CLOSED', source: 'QR', late_minutes: 0, scheduled_end: null, clock_out_corrected: false,
    voided: false, ...patch };
}

function shift(patch: Partial<ReportShift> = {}): ReportShift {
  return { working_date: '2026-10-20', starts_at: at('2026-10-20', '08:00'), ends_at: at('2026-10-20', '09:30'),
    break_starts_at: null, break_ends_at: null, ...patch };
}

function leave(date: string): ReportLeave {
  return { id: `leave-${date}`, type: 'ANNUAL', kind: 'FULL_DAY', from: date, to: date,
    starts_at: at(date, '00:00'), ends_at: at(date, '23:59') };
}

it('FR-013a: a counted session alone is coverage', () => {
  expect(hasAttendanceStatementCoverage(branch({ sessions: [session()] }), PERIOD, CUTOFF, null)).toBe(true);
});

it('FR-013a: a contract day whose default entry ended is coverage', () => {
  expect(hasAttendanceStatementCoverage(branch({ contract }), PERIOD, CUTOFF, null)).toBe(true);
});

it('FR-013a: an approved leave on a contract day is coverage even before the day ends', () => {
  const day = { from: '2026-10-23', to: '2026-10-23' };
  expect(hasAttendanceStatementCoverage(branch({ contract, leave_for_branch: [leave('2026-10-23')] }),
    day, CUTOFF, null)).toBe(true);
});

it('FR-013a: a scheduled shift that ended is coverage', () => {
  expect(hasAttendanceStatementCoverage(branch({ shifts: [shift()] }), PERIOD, CUTOFF, null)).toBe(true);
});

it('FR-013a: an uncorrected missed clock-out alone is not coverage', () => {
  expect(hasAttendanceStatementCoverage(branch({ sessions: [session({ status: 'MISSED_OUT' })] }),
    PERIOD, CUTOFF, null)).toBe(false);
});

it('FR-013a: a shift on the day before the period is not coverage', () => {
  expect(hasAttendanceStatementCoverage(branch({ shifts: [shift({ working_date: '2026-09-30',
    starts_at: at('2026-09-30', '08:00'), ends_at: at('2026-09-30', '09:30') })] }), PERIOD, CUTOFF, null)).toBe(false);
});

it('FR-013a: a shift that has not ended yet is not coverage', () => {
  expect(hasAttendanceStatementCoverage(branch({ shifts: [shift({ working_date: '2026-10-23',
    starts_at: at('2026-10-23', '17:00'), ends_at: at('2026-10-23', '21:00') })] }), PERIOD, CUTOFF, null)).toBe(false);
});

it('FR-013a: a period of only future dates with no leave is not coverage', () => {
  expect(hasAttendanceStatementCoverage(branch({ contract }),
    { from: '2026-11-01', to: '2026-11-30' }, CUTOFF, null)).toBe(false);
});

it('FR-013a: a future contract day with an approved leave is coverage', () => {
  expect(hasAttendanceStatementCoverage(branch({ contract, leave_for_branch: [leave('2026-11-05')] }),
    { from: '2026-11-01', to: '2026-11-30' }, CUTOFF, null)).toBe(true);
});

it('BR-11: a contract day alone is not coverage under a shift filter', () => {
  expect(hasAttendanceStatementCoverage(branch({ contract }), PERIOD, CUTOFF, PAIR)).toBe(false);
});

it('BR-11: an approved leave on a pair date is coverage under a shift filter', () => {
  const row = branch({ shifts: [shift({ working_date: '2026-10-23', starts_at: at('2026-10-23', '09:00'),
    ends_at: at('2026-10-23', '20:00') })], leave_for_branch: [leave('2026-10-23')] });
  expect(hasAttendanceStatementCoverage(row, PERIOD, CUTOFF, PAIR)).toBe(true);
});

it('BR-11: an approved leave on another date is not coverage under a shift filter', () => {
  const row = branch({ shifts: [shift({ working_date: '2026-10-23', starts_at: at('2026-10-23', '09:00'),
    ends_at: at('2026-10-23', '20:00') })], leave_for_branch: [leave('2026-10-24')] });
  expect(hasAttendanceStatementCoverage(row, PERIOD, CUTOFF, PAIR)).toBe(false);
});

it('BR-11: a session attributed to the matching shift is coverage under a shift filter', () => {
  const row = branch({ shifts: [shift({ working_date: '2026-10-23', starts_at: at('2026-10-23', '09:00'),
    ends_at: at('2026-10-23', '20:00') })],
  sessions: [session({ working_date: '2026-10-23', scheduled_end: at('2026-10-23', '20:00') })] });
  expect(hasAttendanceStatementCoverage(row, PERIOD, CUTOFF, PAIR)).toBe(true);
});

it('BR-11: an ended matching shift is coverage under a shift filter', () => {
  const row = branch({ shifts: [shift({ working_date: '2026-10-23', starts_at: at('2026-10-23', '09:00'),
    ends_at: at('2026-10-23', '20:00') })] });
  expect(hasAttendanceStatementCoverage(row, PERIOD, '2026-10-23T21:00:00+03:00', PAIR)).toBe(true);
});

it('BR-11: a matching shift that ends exactly at the request is coverage under a shift filter', () => {
  const row = branch({ shifts: [shift({ working_date: '2026-10-23', starts_at: at('2026-10-23', '09:00'),
    ends_at: at('2026-10-23', '20:00') })] });
  expect(hasAttendanceStatementCoverage(row, PERIOD, at('2026-10-23', '20:00'), PAIR)).toBe(true);
});

it('FR-013a: a contract day that has not ended and nothing else is not coverage', () => {
  expect(hasAttendanceStatementCoverage(branch({ contract }), { from: '2026-10-23', to: '2026-10-23' },
    CUTOFF, null)).toBe(false);
});
