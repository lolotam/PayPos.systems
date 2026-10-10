import { describe, expect, it } from 'vitest';
import {
  addScheduleDays,
  scheduleInstant,
  scheduleToday,
  validateScheduleWeek,
} from '../schedule-calendar.ts';
import {
  materializeSchedule,
  nextScheduleRevision,
  requirePastScheduleReason,
  validateScheduleEmployee,
  validateScheduleOverlap,
  validateSchedulePattern,
} from '../schedules.ts';
import {
  requireActiveTemplate,
  requireTemplateReplacement,
  validateTemplateWeeks,
  validateTemplateBatch,
} from '../schedule-templates.ts';
import type { ScheduleRecord, SchedulingEmployee, WeeklyShift } from '../schedule-types.ts';
const week = '2026-10-03';
const pattern = (day = 0, start = '09:00', end = '17:00'): WeeklyShift[] => [{ day, start, end }];
const shifts = (day = 0, start = '09:00', end = '17:00') =>
  materializeSchedule(week, pattern(day, start, end), 'Asia/Kuwait', 3);
const employee: SchedulingEmployee = {
  id: 'synthetic',
  business_id: 'synthetic',
  hire_date: '2026-01-01',
  contract_end: null,
  deleted_at: null,
  attachments: [{ branch_id: 'branch', from: '2026-01-01', to: null }],
};

describe('Saturday civil weeks and timezone instants', () => {
  it.each(['2026-10-04', '2026-02-30', 'invalid', '2026-10-02'])(
    'refuses invalid Saturday %s',
    (date) => expect(() => validateScheduleWeek(date)).toThrow('SCHEDULE_WEEK_INVALID'),
  );
  it('keeps seven days and crosses year/month/leap-day boundaries', () => {
    expect(() => validateScheduleWeek(week)).not.toThrow();
    expect(addScheduleDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addScheduleDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addScheduleDays(week, 6)).toBe('2026-10-09');
  });
  it('defines today in the branch zone at the UTC date boundary', () =>
    expect(scheduleToday(new Date('2026-10-02T22:00:00Z'), 'Asia/Kuwait')).toBe(week));
  it('resolves fractional-offset zones as well as Kuwait', () => {
    expect(scheduleInstant(week, '09:00', 'Asia/Kuwait')).toBe('2026-10-03T06:00:00.000Z');
    expect(scheduleInstant(week, '09:00', 'Asia/Kathmandu')).toBe('2026-10-03T03:15:00.000Z');
  });
  it.each([
    ['2026-03-08', '02:30'],
    ['2026-11-01', '01:30'],
  ])('refuses DST gap/fold %s %s', (day, time) =>
    expect(() => scheduleInstant(day, time, 'America/New_York')).toThrow(
      'SCHEDULE_LOCAL_TIME_INVALID',
    ),
  );
  it('rejects an unknown timezone', () =>
    expect(() => scheduleInstant(week, '09:00', 'invalid')).toThrow('SCHEDULE_LOCAL_TIME_INVALID'));
});
describe('split, overnight, duration and overlap rules', () => {
  it('permits empty weeks and touching split shifts, sorts without mutating input', () => {
    const input = [
      { day: 0, start: '13:00', end: '17:00' },
      { day: 0, start: '09:00', end: '13:00' },
    ];
    expect(validateSchedulePattern(input, 3)[0]?.start).toBe('09:00');
    expect(input[0]?.start).toBe('13:00');
    expect(validateSchedulePattern([], 3)).toEqual([]);
  });
  it.each(
    [
      pattern(0, '09:00', '09:00'),
      pattern(0, '09:00', '01:01'),
      pattern(0, '00:00', '16:01'),
      pattern(0, '24:00', '08:00'),
      pattern(0, '09:60', '17:00'),
      pattern(-1),
      pattern(7),
      pattern(0.5),
    ].map((input) => ({ input })),
  )('refuses invalid day/time/duration/count %j', ({ input }) =>
    expect(() => validateSchedulePattern(input, 3)).toThrow('SCHEDULE_SHIFT_INVALID'),
  );
  it('permits exactly 16h including overnight and preserves Friday start day across weeks', () => {
    expect(shifts(0, '08:00', '00:00')[0]?.ends_at).toBe('2026-10-03T21:00:00.000Z');
    expect(shifts(6, '22:00', '06:00')[0]).toEqual({
      day: 6,
      start: '22:00',
      end: '06:00',
      working_date: '2026-10-09',
      starts_at: '2026-10-09T19:00:00.000Z',
      ends_at: '2026-10-10T03:00:00.000Z',
    });
  });
  it('refuses same-day and neighboring-day overnight overlap', () => {
    expect(() =>
      validateSchedulePattern([...pattern(), ...pattern(0, '16:00', '18:00')], 3),
    ).toThrow('SCHEDULE_SHIFT_OVERLAP');
    expect(() =>
      validateSchedulePattern(
        [...pattern(0, '22:00', '06:00'), ...pattern(1, '05:00', '08:00')],
        3,
      ),
    ).toThrow('SCHEDULE_SHIFT_OVERLAP');
  });
});
describe('cross-boundary overlaps', () => {
  it('compares Friday→Saturday and cross-zone/cross-branch shifts as half-open intervals', () => {
    const friday = shifts(6, '22:00', '06:00');
    const saturday = materializeSchedule(
      '2026-10-10',
      pattern(0, '05:00', '08:00'),
      'Asia/Kuwait',
      3,
    );
    expect(() => validateScheduleOverlap(friday, saturday, 3)).toThrow('SCHEDULE_SHIFT_OVERLAP');
    expect(() =>
      validateScheduleOverlap(
        friday,
        materializeSchedule('2026-10-10', pattern(0, '06:00', '08:00'), 'Asia/Kuwait', 3),
        3,
      ),
    ).not.toThrow();
    expect(() =>
      validateScheduleOverlap(
        shifts(),
        materializeSchedule(week, pattern(0, '10:00', '12:00'), 'Asia/Dubai', 3),
        3,
      ),
    ).toThrow('SCHEDULE_SHIFT_OVERLAP');
  });
  it('counts split shifts across branches too', () =>
    expect(() =>
      validateScheduleOverlap(
        shifts(0, '01:00', '02:00'),
        [
          ...shifts(0, '03:00', '04:00'),
          ...shifts(0, '05:00', '06:00'),
          ...shifts(0, '07:00', '08:00'),
        ],
        3,
      ),
    ).toThrow('SCHEDULE_DAY_LIMIT_EXCEEDED'));
  it('refuses elapsed durations over 16h on a DST fallback day', () =>
    expect(() =>
      materializeSchedule('2026-10-31', pattern(1, '00:00', '16:00'), 'America/New_York', 3),
    ).toThrow('SCHEDULE_SHIFT_INVALID'));
});
describe('eligibility, reasons and revisions', () => {
  it('uses inclusive attach and exclusive detach, contract end inclusive', () => {
    const dated = {
      ...employee,
      contract_end: week,
      attachments: [{ branch_id: 'branch', from: week, to: '2026-10-04' }],
    };
    expect(() => validateScheduleEmployee(dated, 'branch', shifts())).not.toThrow();
    expect(() => validateScheduleEmployee(dated, 'branch', shifts(1))).toThrow(
      'SCHEDULE_EMPLOYEE_INELIGIBLE',
    );
  });
  it.each([
    { ...employee, deleted_at: '2026-10-01' },
    { ...employee, hire_date: '2026-10-04' },
    { ...employee, contract_end: '2026-10-02' },
    { ...employee, attachments: [] },
  ])('refuses an ineligible employee %j', (value) =>
    expect(() => validateScheduleEmployee(value, 'branch', shifts())).toThrow(
      'SCHEDULE_EMPLOYEE_INELIGIBLE',
    ),
  );
  it('requires reason for adding/changing/removing a past shift, allows today/future and unchanged history', () => {
    expect(() => requirePastScheduleReason([], shifts(), '2026-10-04')).toThrow(
      'SCHEDULE_PAST_REASON_REQUIRED',
    );
    expect(() => requirePastScheduleReason(shifts(), [], '2026-10-04', ' ')).toThrow(
      'SCHEDULE_PAST_REASON_REQUIRED',
    );
    expect(() => requirePastScheduleReason(shifts(), shifts(0, '10:00'), '2026-10-04')).toThrow(
      'SCHEDULE_PAST_REASON_REQUIRED',
    );
    expect(() => requirePastScheduleReason(shifts(), shifts(), '2026-10-04')).not.toThrow();
    expect(() => requirePastScheduleReason([], shifts(), week)).not.toThrow();
    expect(() =>
      requirePastScheduleReason([], shifts(), '2026-10-04', 'Synthetic correction'),
    ).not.toThrow();
  });
  it('protects missing and existing week revisions', () => {
    expect(nextScheduleRevision(0, 0)).toBe(1);
    expect(nextScheduleRevision(5, 5)).toBe(6);
    expect(() => nextScheduleRevision(1, 0)).toThrow('SCHEDULE_REVISION_CONFLICT');
  });
});
describe('template apply policy', () => {
  it('bounds synchronous copies without reducing the twelve-week limit', () => {
    expect(() => validateTemplateBatch(1, 12)).not.toThrow();
    expect(() => validateTemplateBatch(20, 1)).not.toThrow();
    expect(() => validateTemplateBatch(2, 10)).not.toThrow();
    expect(() => validateTemplateBatch(2, 12)).toThrow('SCHEDULE_APPLY_BATCH_TOO_LARGE');
  });
  it('permits 12 distinct Saturdays and refuses 13, duplicates and non-Saturdays', () => {
    const weeks = Array.from({ length: 12 }, (_, i) => addScheduleDays(week, i * 7));
    expect(() => validateTemplateWeeks(weeks)).not.toThrow();
    for (const input of [[], [...weeks, '2027-01-02'], [week, week], ['2026-10-04']])
      expect(() => validateTemplateWeeks(input)).toThrow('SCHEDULE_WEEK_INVALID');
  });
  it('lists explicit conflicts and requires reason for replace', () => {
    const existing = {
      employee_id: 'employee',
      branch_id: 'branch',
      week_start: week,
    } as ScheduleRecord;
    expect(() => requireTemplateReplacement([existing], false)).toThrow('SCHEDULE_APPLY_CONFLICT');
    expect(() => requireTemplateReplacement([existing], true)).toThrow(
      'SCHEDULE_REPLACE_REASON_REQUIRED',
    );
    expect(() =>
      requireTemplateReplacement([existing], true, 'Synthetic replacement'),
    ).not.toThrow();
    expect(() => requireTemplateReplacement([], false)).not.toThrow();
  });
  it('refuses archived patterns', () =>
    expect(() => requireActiveTemplate({ archived_at: '2026-10-03' } as never)).toThrow(
      'SCHEDULE_TEMPLATE_ARCHIVED',
    ));
});
