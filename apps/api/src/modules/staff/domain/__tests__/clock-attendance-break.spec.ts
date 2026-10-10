import { describe, expect, it } from 'vitest';
import {
  attendanceReturnSchedule,
  attendanceSchedule,
  planAttendance,
  type AttendancePlanInput,
} from '../clock-attendance.ts';

const at = (time: string, date = '2026-10-03') => new Date(`${date}T${time}:00+03:00`);
const shift = {
  startsAt: at('09:00'),
  endsAt: at('17:00'),
  workingDate: '2026-10-03',
  breakStartsAt: at('13:00'),
  breakEndsAt: at('14:00'),
  returning: true,
};
const input: AttendancePlanInput = {
  open: null,
  timezone: 'Asia/Kuwait',
  shifts: [shift],
  location: undefined,
  geo: null,
  source: 'BARCODE',
};

describe('BW-Q5/BW-Q9 return comparison and stored schedule', () => {
  it.each([
    ['13:00', 0],
    ['13:45', 0],
    ['14:00', 0],
    ['14:05', 0],
    ['14:10', 0],
    ['14:11', 11],
    ['14:12', 12],
  ] as const)('return at %s reports %i minutes from break end', (time, late) => {
    const plan = planAttendance(input, at(time), 'return');
    expect(plan.result).toMatchObject({ operation: 'CLOCK_IN', late_minutes: late });
    expect(plan.schedule).toEqual({ startsAt: shift.breakEndsAt, endsAt: shift.endsAt });
    expect(shift.startsAt).toEqual(at('09:00'));
    expect(attendanceSchedule([shift], at(time), shift.workingDate)).toBe(shift);
  });
});

describe('clock-ins outside the return rule retain spec 027', () => {
  it('first arrival after break start stays late from shift start', () => {
    const plan = planAttendance(
      { ...input, shifts: [{ ...shift, returning: false }] },
      at('13:30'),
      'first',
    );
    expect(plan.result.late_minutes).toBe(270);
    expect(plan.schedule?.startsAt).toEqual(shift.startsAt);
  });

  it.each([
    { breakStartsAt: null, breakEndsAt: null },
    { breakStartsAt: null },
    { breakEndsAt: null },
  ])('without a complete break keeps spec 027', (patch) => {
    const plan = planAttendance({ ...input, shifts: [{ ...shift, ...patch }] }, at('14:05'), 'in');
    expect(plan.result.late_minutes).toBe(305);
    expect(plan.schedule?.startsAt).toEqual(shift.startsAt);
  });

  it('a return before break start stays measured from shift start', () => {
    const plan = planAttendance(input, at('11:20'), 'in');
    expect(plan.result.late_minutes).toBe(140);
    expect(plan.schedule?.startsAt).toEqual(shift.startsAt);
  });

  it('clock-out preserves the open session lateness across the break', () => {
    const plan = planAttendance(
      {
        ...input,
        open: {
          id: 'morning',
          clockIn: at('09:23'),
          workingDate: shift.workingDate,
          lateMinutes: 23,
          branchId: 'branch',
        },
      },
      at('17:00'),
      'unused',
    );
    expect(plan.result).toMatchObject({
      session_id: 'morning',
      operation: 'CLOCK_OUT',
      late_minutes: 23,
    });
  });
});

describe('return selection preserves AT-Q5 and legacy callers', () => {
  it('absent new fields and absent returning keep the original comparison', () => {
    const legacy = {
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      workingDate: shift.workingDate,
    };
    for (const candidate of [
      legacy,
      { ...legacy, breakStartsAt: shift.breakStartsAt, breakEndsAt: shift.breakEndsAt },
    ]) {
      expect(attendanceReturnSchedule([candidate], at('14:05'), shift.workingDate)).toBe(candidate);
      expect(
        planAttendance({ ...input, shifts: [candidate] }, at('14:05'), 'in').result.late_minutes,
      ).toBe(305);
    }
  });

  it('no candidate still means no scheduled start and no lateness', () => {
    expect(attendanceReturnSchedule([], at('14:05'), shift.workingDate)).toBeNull();
    expect(planAttendance({ ...input, shifts: [] }, at('14:05'), 'in').result.late_minutes).toBe(0);
  });

  it('only the chosen shift supplies the returning fact', () => {
    const earlier = {
      ...shift,
      endsAt: at('12:00'),
      breakStartsAt: at('10:00'),
      breakEndsAt: at('11:00'),
    };
    const later = {
      ...shift,
      startsAt: at('13:00'),
      breakStartsAt: at('15:00'),
      breakEndsAt: at('16:00'),
      returning: false,
    };
    expect(attendanceReturnSchedule([later, earlier], at('16:12'), shift.workingDate)).toBe(later);
    expect(attendanceReturnSchedule([later, earlier], at('08:58'), shift.workingDate)).toBe(
      earlier,
    );
  });
});

describe('overnight break returns', () => {
  it.each([
    ['01:05', 0],
    ['01:12', 12],
  ] as const)('overnight return at %s reports %i', (time, late) => {
    const overnight = {
      ...shift,
      startsAt: at('20:00'),
      endsAt: at('04:00', '2026-10-04'),
      breakStartsAt: at('00:30', '2026-10-04'),
      breakEndsAt: at('01:00', '2026-10-04'),
    };
    const next = {
      ...shift,
      startsAt: at('09:00', '2026-10-04'),
      endsAt: at('17:00', '2026-10-04'),
      workingDate: '2026-10-04',
    };
    const plan = planAttendance(
      { ...input, shifts: [next, overnight] },
      at(time, '2026-10-04'),
      'in',
    );
    expect(plan.result.late_minutes).toBe(late);
    expect(plan.schedule).toEqual({ startsAt: overnight.breakEndsAt, endsAt: overnight.endsAt });
  });
});
