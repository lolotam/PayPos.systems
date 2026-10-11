import { expect, it } from 'vitest';
import { computeAttendanceMonthlyReport } from '../attendance-monthly-report.js';
import { workedAttendanceMinutes } from '../attendance-worked-minutes.js';
import type { ReportBranchInputs, ReportSession } from '../attendance-report-types.js';

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

it('BW-Q8 credits an overnight break across session clock-in dates in Kuwait', () => {
  const branch = overnight();
  expect(workedAttendanceMinutes(branch.sessions, branch.shifts)).toBe(480);
  expect(computeAttendanceMonthlyReport([branch], '2026-10')).toMatchObject({ worked_minutes: 480, days_present: 2 });
});

it('attributes October 31 session plus its break credit to October, and November 1 return session to November', () => {
  const branch = overnight('2026-10-31', '2026-11-01');
  const before = { ...branch, sessions: branch.sessions.map((session) => ({ ...session })),
    shifts: branch.shifts.map((shift) => ({ ...shift })) };
  expect(computeAttendanceMonthlyReport([branch], '2026-10')).toMatchObject({
    worked_minutes: 300, scheduled_minutes: 480, days_present: 1,
  });
  expect(computeAttendanceMonthlyReport([branch], '2026-11')).toMatchObject({
    worked_minutes: 180, scheduled_minutes: 0, days_present: 1,
  });
  expect(computeAttendanceMonthlyReport([branch], '2026-12').worked_minutes).toBe(0);
  expect(branch).toEqual(before);
});

it.each([
  ['before break', '23:59', '01:00', 419],
  ['after break', '00:30', '01:01', 449],
])('does not credit overnight gaps %s', (_label, out, back, expected) => {
  const branch = overnight('2026-10-03', '2026-10-04', String(out), String(back));
  if (out === '23:59') {
    branch.sessions = branch.sessions.map((session, index) => index === 0
      ? { ...session, clock_out: '2026-10-03T23:59:00+03:00' } : session);
  }
  expect(computeAttendanceMonthlyReport([branch], '2026-10').worked_minutes).toBe(Number(expected));
});

it('computes adjacency per shift even if a different shift session intervenes in the input', () => {
  const branch = overnight();
  const first = branch.sessions[0];
  if (!first) throw new Error('MISSING_SYNTHETIC_SESSION');
  const extra: ReportSession = { ...first, working_date: '2026-10-04',
    clock_in: '2026-10-04T00:40:00+03:00', clock_out: '2026-10-04T00:50:00+03:00',
    scheduled_end: '2026-10-04T05:00:00+03:00' };
  expect(workedAttendanceMinutes([...branch.sessions, extra], branch.shifts)).toBe(480);
});

it('credits two shifts on the same day only within each shift own break', () => {
  const branch = overnight('2026-10-03', '2026-10-04');
  const second = overnight('2026-10-03', '2026-10-03');
  second.shifts = [{ working_date: '2026-10-03', starts_at: '2026-10-03T08:00:00+03:00',
    ends_at: '2026-10-03T16:00:00+03:00', break_starts_at: '2026-10-03T12:00:00+03:00',
    break_ends_at: '2026-10-03T13:00:00+03:00' }];
  const common = second.sessions[0];
  if (!common) throw new Error('MISSING_SYNTHETIC_SESSION');
  second.sessions = [
    { ...common, clock_in: '2026-10-03T08:00:00+03:00', clock_out: '2026-10-03T12:00:00+03:00', scheduled_end: second.shifts[0]?.ends_at ?? null },
    { ...common, clock_in: '2026-10-03T13:00:00+03:00', clock_out: '2026-10-03T16:00:00+03:00', scheduled_end: second.shifts[0]?.ends_at ?? null },
  ];
  expect(workedAttendanceMinutes([...branch.sessions, ...second.sessions], [...branch.shifts, ...second.shifts])).toBe(960);
});

it.each([
  { status: 'OPEN', clock_out: null },
  { voided: true },
  { status: 'MISSED_OUT', clock_out_corrected: false },
])('does not credit an overnight break from an excluded return %j', (patch) => {
  const branch = overnight();
  branch.sessions = branch.sessions.map((session, index) => index === 1 ? { ...session, ...patch } as ReportSession : session);
  expect(computeAttendanceMonthlyReport([branch], '2026-10').worked_minutes).toBe(270);
});
