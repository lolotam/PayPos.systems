import { expect, it } from 'vitest';
import { computeAttendanceStatementDays } from '../attendance-statement-days.js';
import type { AttendanceOpenSession, ReportBranchInputs, ReportContract, ReportLeave, ReportSession, ReportShift } from '../attendance-report-types.js';

const PERIOD = { from: '2026-10-01', to: '2026-10-15' };
const CUTOFF = '2026-10-15T21:00:00+03:00';
const at = (date: string, time: string) => `${date}T${time}:00+03:00`;

const contract: ReportContract = { hire_date: '2026-01-01', contract_end: null,
  links: [{ from: '2026-01-01', to: null }],
  entries: Array.from({ length: 7 }, (_, day) => ({ day, start: '09:00', end: '17:00' })) };

function branch(patch: Partial<ReportBranchInputs> = {}): ReportBranchInputs {
  return { timezone: 'Asia/Kuwait', contract: null, leave_for_branch: [], shifts: [], sessions: [], ...patch };
}

function session(patch: Partial<ReportSession> = {}): ReportSession {
  return { working_date: '2026-10-03', clock_in: at('2026-10-03', '09:00'), clock_out: at('2026-10-03', '17:00'),
    status: 'CLOSED', source: 'QR', late_minutes: 0, scheduled_end: null, clock_out_corrected: false,
    voided: false, ...patch };
}

function shift(patch: Partial<ReportShift> = {}): ReportShift {
  return { working_date: '2026-10-03', starts_at: at('2026-10-03', '09:00'), ends_at: at('2026-10-03', '17:00'),
    break_starts_at: null, break_ends_at: null, ...patch };
}

const open: AttendanceOpenSession[] = [{ working_date: '2026-10-04', clock_in: at('2026-10-04', '08:30') }];

it('Story 2.2: every date of the period has one entry, in date order', () => {
  const days = computeAttendanceStatementDays(branch(), [], PERIOD, CUTOFF);
  expect(days).toHaveLength(15);
  expect(days.map((day) => day.date)).toEqual(Array.from({ length: 15 }, (_, index) =>
    `2026-10-${String(index + 1).padStart(2, '0')}`));
  expect(days[0]).toEqual({ date: '2026-10-01', sessions: [], worked_minutes: 0, still_in: false,
    leave: [], scheduled: [], no_attendance: false });
});

it('Story 2.2: a counted session shows its lateness and its manual note', () => {
  const days = computeAttendanceStatementDays(branch({ sessions: [session({ source: 'MANUAL', late_minutes: 20,
    clock_in: at('2026-10-03', '09:20'), clock_out: at('2026-10-03', '12:00') })] }), [], PERIOD, CUTOFF);
  expect(days[2]).toMatchObject({ date: '2026-10-03', worked_minutes: 160, no_attendance: false });
  expect(days[2]?.sessions).toEqual([{ clock_in: at('2026-10-03', '09:20'), clock_out: at('2026-10-03', '12:00'),
    late_minutes: 20, manual: true, counted: true, missing_clock_out: false }]);
});

it('BR-05: an uncorrected missed clock-out shows the note and adds nothing', () => {
  const days = computeAttendanceStatementDays(branch({ sessions: [session({ status: 'MISSED_OUT' })] }), [],
    PERIOD, CUTOFF);
  expect(days[2]).toMatchObject({ worked_minutes: 0 });
  expect(days[2]?.sessions[0]).toMatchObject({ counted: false, missing_clock_out: true });
});

it('BR-05: a corrected missed clock-out counts with its hours', () => {
  const days = computeAttendanceStatementDays(branch({ sessions: [session({ status: 'MISSED_OUT',
    clock_out_corrected: true })] }), [], PERIOD, CUTOFF);
  expect(days[2]).toMatchObject({ worked_minutes: 480 });
  expect(days[2]?.sessions[0]).toMatchObject({ counted: true, missing_clock_out: false });
});

it('AB-Q9g: an open session shows still clocked in and never a missing attendance note', () => {
  const days = computeAttendanceStatementDays(branch({ shifts: [shift({ working_date: '2026-10-04' })] }), open,
    PERIOD, CUTOFF);
  expect(days[3]).toMatchObject({ date: '2026-10-04', still_in: true, no_attendance: false, worked_minutes: 0 });
});

it('FR-013a: an ended shift with no session shows the scheduled times and the missing attendance note', () => {
  const days = computeAttendanceStatementDays(branch({ shifts: [shift()] }), [], PERIOD, CUTOFF);
  expect(days[2]).toMatchObject({ date: '2026-10-03', no_attendance: true, worked_minutes: 0 });
  expect(days[2]?.scheduled).toEqual([{ starts_at: at('2026-10-03', '09:00'), ends_at: at('2026-10-03', '17:00') }]);
});

it('FR-013a: a shift that has not ended shows the date only', () => {
  const days = computeAttendanceStatementDays(branch({ shifts: [shift({ working_date: '2026-10-15',
    starts_at: at('2026-10-15', '18:00'), ends_at: at('2026-10-15', '22:00') })] }), [], PERIOD, CUTOFF);
  expect(days[14]).toMatchObject({ date: '2026-10-15', scheduled: [], no_attendance: false, worked_minutes: 0 });
});

it('FR-013a: a shift that ends exactly at the request is listed and shows the missing attendance note', () => {
  const days = computeAttendanceStatementDays(branch({ shifts: [shift({ working_date: '2026-10-15',
    starts_at: at('2026-10-15', '18:00'), ends_at: at('2026-10-15', '21:00') })] }), [], PERIOD, CUTOFF);
  expect(days[14]).toMatchObject({ date: '2026-10-15', no_attendance: true, worked_minutes: 0 });
  expect(days[14]?.scheduled).toEqual([{ starts_at: at('2026-10-15', '18:00'), ends_at: at('2026-10-15', '21:00') }]);
});

it('AB-Q4: a leave date lists its type on a contract day', () => {
  const leave: ReportLeave = { id: 'annual-05', type: 'ANNUAL', kind: 'FULL_DAY', from: '2026-10-05',
    to: '2026-10-05', starts_at: at('2026-10-05', '00:00'), ends_at: at('2026-10-06', '00:00') };
  const days = computeAttendanceStatementDays(branch({ contract, leave_for_branch: [leave] }), [], PERIOD, CUTOFF);
  expect(days[4]).toMatchObject({ date: '2026-10-05', leave: ['ANNUAL'] });
  expect(days[3]?.leave).toEqual([]);
});

it('AB-Q9b: an overnight session belongs to its clock-in date and its break credit lands there', () => {
  const ends = at('2026-10-04', '06:00');
  const row = branch({ shifts: [{ working_date: '2026-10-03', starts_at: at('2026-10-03', '22:00'), ends_at: ends,
    break_starts_at: at('2026-10-04', '00:00'), break_ends_at: at('2026-10-04', '01:00') }],
  sessions: [
    { ...session({ working_date: '2026-10-03', clock_in: at('2026-10-03', '22:00'), clock_out: at('2026-10-04', '00:30'),
      scheduled_end: ends }) },
    { ...session({ working_date: '2026-10-04', clock_in: at('2026-10-04', '01:00'), clock_out: ends,
      scheduled_end: ends }) }] });
  const days = computeAttendanceStatementDays(row, [], PERIOD, CUTOFF);
  expect(days[2]).toMatchObject({ date: '2026-10-03', worked_minutes: 180 });
  expect(days[3]).toMatchObject({ date: '2026-10-04', worked_minutes: 300 });
});
