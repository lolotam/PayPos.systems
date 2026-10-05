import { describe, expect, it } from 'vitest';
import {
  attendanceTransition,
  attendanceDuplicate,
  attendanceWorkingDate,
  attendanceDistance,
  attendanceGeofence,
  attendanceLateMinutes,
  attendanceMissedDeadline,
  attendanceSchedule,
  attendanceEligible,
  type ClockResult,
} from '../clock-attendance.ts';

const start = new Date('2026-10-04T19:00:00Z');
const open = {
  id: 'synthetic',
  clockIn: start,
  workingDate: '2026-10-04',
  branchId: 'branch',
  lateMinutes: 0,
};
const after = (ms: number) => new Date(start.getTime() + ms);
const result: ClockResult = {
  session_id: 'synthetic',
  operation: 'CLOCK_IN',
  working_date: '2026-10-04',
  accepted_at: start.toISOString(),
  exceptions: ['NONE'],
  late_minutes: 0,
  missed_session_id: null,
};

describe('attendance transition and unchanged dedupe', () => {
  it('opens without an existing session', () =>
    expect(attendanceTransition(null, start)).toBe('IN'));
  it.each([
    [0, 'OUT'],
    [16 * 3600000 - 1, 'OUT'],
    [16 * 3600000, 'MISSED_IN'],
    [16 * 3600000 + 1, 'MISSED_IN'],
    [72 * 3600000, 'MISSED_IN'],
  ] as const)('age %i selects %s', (age, transition) =>
    expect(attendanceTransition(open, after(age))).toBe(transition),
  );
  it.each([0, 1, 299999])('dedupe at %i returns the same object', (ms) =>
    expect(attendanceDuplicate(start, result, after(ms))).toBe(result),
  );
  it.each([300000, 300001])('at %i permits another transition', (ms) =>
    expect(attendanceDuplicate(start, result, after(ms))).toBeNull(),
  );
  it('no previous acceptance means no dedupe', () =>
    expect(attendanceDuplicate(null, null, start)).toBeNull());
  it('missed closure is the precise sixteen-hour deadline', () =>
    expect(attendanceMissedDeadline(open)).toEqual(after(16 * 3600000)));
});
describe('branch dates and schedule facts', () => {
  it.each([
    ['2026-10-04T20:59:59Z', 'Asia/Kuwait', '2026-10-04'],
    ['2026-10-04T21:00:00Z', 'Asia/Kuwait', '2026-10-05'],
    ['2026-03-08T06:59:59Z', 'America/New_York', '2026-03-08'],
    ['2026-03-08T07:00:00Z', 'America/New_York', '2026-03-08'],
    ['2026-11-01T05:30:00Z', 'America/New_York', '2026-11-01'],
    ['2026-11-01T06:30:00Z', 'America/New_York', '2026-11-01'],
  ])('%s in %s has date %s', (instant, zone, date) =>
    expect(attendanceWorkingDate(new Date(instant), zone)).toBe(date),
  );
  it('closing overnight keeps the original date on the aggregate', () => {
    expect(attendanceTransition(open, after(7 * 3600000))).toBe('OUT');
    expect(open.workingDate).toBe('2026-10-04');
    expect(attendanceWorkingDate(after(7 * 3600000), 'Asia/Kuwait')).toBe('2026-10-05');
  });
  it.each([
    [0, 0],
    [-60000, 0],
    [600000, 0],
    [600001, 10],
    [660000, 11],
  ])('lateness at %i is %i', (ms, minutes) =>
    expect(attendanceLateMinutes(start, after(ms))).toBe(minutes),
  );
  it('no schedule never invents lateness', () =>
    expect(attendanceLateMinutes(null, after(3600000))).toBe(0));
  it('selects an overnight containing shift before a new date shift', () => {
    const prior = { startsAt: start, endsAt: after(8 * 3600000), workingDate: '2026-10-04' };
    const next = {
      startsAt: after(9 * 3600000),
      endsAt: after(10 * 3600000),
      workingDate: '2026-10-05',
    };
    expect(attendanceSchedule([next, prior], after(7 * 3600000), '2026-10-05')).toBe(prior);
    expect(attendanceSchedule([next], after(7 * 3600000), '2026-10-05')).toBe(next);
    expect(attendanceSchedule([], start, '2026-10-04')).toBeNull();
  });
});
describe('geofence is an exception, never a refusal', () => {
  const branch = { lat: 0, lng: 0 };
  const location = (meters: number, accuracy = 0) => ({
    lat: ((meters / 6371000) * 180) / Math.PI,
    lng: 0,
    accuracy,
  });
  it('zero, equatorial distance and antipodes are stable', () => {
    expect(attendanceDistance(branch, branch)).toBe(0);
    expect(attendanceDistance(branch, { lat: 0, lng: 1 })).toBeCloseTo(111194.9266, 3);
    expect(attendanceDistance(branch, { lat: 0, lng: 180 })).toBeCloseTo(Math.PI * 6371000);
  });
  it.each([
    [149.999, 0, 'OK'],
    [150, 0, 'OK'],
    [150.001, 0, 'OUT_OF_RANGE'],
    [200, 51, 'OK'],
    [200, 49, 'OUT_OF_RANGE'],
  ] as const)('%i meters accuracy %i: %s', (meters, accuracy, geo) =>
    expect(attendanceGeofence(location(meters, accuracy), branch)).toBe(geo),
  );
  it('missing permission or configuration produces NONE', () => {
    expect(attendanceGeofence(undefined, branch)).toBe('NONE');
    expect(attendanceGeofence(location(0), null)).toBe('NONE');
  });
});
describe('dated branch eligibility', () => {
  const employee = {
    hire_date: '2026-01-01',
    contract_end: '2026-10-04',
    attachments: [{ branch_id: 'branch', from: '2026-01-01', to: '2026-10-05' }],
  };
  it.each([
    ['2025-12-31', false],
    ['2026-01-01', true],
    ['2026-10-04', true],
    ['2026-10-05', false],
  ])('%s is eligible: %s', (date, eligible) =>
    expect(attendanceEligible(employee, 'branch', date as string)).toBe(eligible),
  );
  it('a primary branch with no dated attachment is refused', () =>
    expect(attendanceEligible({ ...employee, attachments: [] }, 'branch', '2026-10-04')).toBe(
      false,
    ));
  it('an unrelated QR branch is refused', () =>
    expect(attendanceEligible(employee, 'other', '2026-10-04')).toBe(false));
});
