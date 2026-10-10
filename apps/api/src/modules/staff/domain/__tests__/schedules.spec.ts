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
  validateShiftBreak,
} from '../schedules.ts';
import {
  requireActiveTemplate,
  requireTemplateReplacement,
  validateTemplateWeeks,
  validateTemplateBatch,
} from '../schedule-templates.ts';
import type { ScheduleRecord, SchedulingEmployee, WeeklyShift } from '../schedule-types.ts';
const week = '2026-10-03';
const pattern = (day = 0, start = '09:00', end = '17:00'): WeeklyShift[] => [
  { day, start, end, break_start: null, break_end: null },
];
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

it('counts only the saving branch but checks overlap against every branch', () => {
  const otherBranch = [...shifts(0, '01:00', '02:00'), ...shifts(0, '03:00', '04:00')].map((s) => ({
    ...s,
    branch_id: 'hawalli',
  }));
  const own = shifts(0, '05:00', '06:00');
  expect(() => validateScheduleOverlap(own, otherBranch, 2, undefined, 'salmiya')).not.toThrow();
  expect(() =>
    validateScheduleOverlap(
      own,
      otherBranch.map((s) => ({ ...s, branch_id: 'salmiya' })),
      2,
      undefined,
      'salmiya',
    ),
  ).toThrow(expect.objectContaining({ details: { max_shifts_per_day: 2, working_dates: [week] } }));
  expect(() =>
    validateScheduleOverlap(shifts(0, '01:30', '02:30'), otherBranch, 2, undefined, 'salmiya'),
  ).toThrow('SCHEDULE_SHIFT_OVERLAP');
  expect(() =>
    validateScheduleOverlap(
      [...own, ...shifts(0, '07:00', '08:00'), ...shifts(0, '09:00', '10:00')],
      [],
      2,
      [],
      'salmiya',
    ),
  ).not.toThrow();
});

it.each([
  ['09:00', '17:00', '13:00', '14:00', true],
  ['09:00', '17:00', '16:30', '17:30', false],
  ['09:00', '17:00', '08:30', '09:30', false],
  ['09:00', '17:00', '13:00', '17:00', false],
  ['09:00', '17:00', '09:00', '10:00', false],
  ['09:00', '17:00', '13:00', '13:00', false],
  ['09:00', '17:00', '14:00', '13:00', false],
  ['09:00', '17:00', '13:00', null, false],
  ['09:00', '17:00', null, '14:00', false],
  ['20:00', '04:00', '00:30', '01:00', true],
  ['20:00', '04:00', '23:30', '00:30', true],
  ['20:00', '04:00', '03:30', '04:30', false],
  ['09:00', '09:01', null, null, true],
  ['08:00', '00:00', null, null, true],
] as const)(
  'validates break placement %s–%s / %s–%s',
  (start, end, break_start, break_end, valid) => {
    const run = () => validateShiftBreak({ day: 0, start, end, break_start, break_end });
    if (valid) expect(run).not.toThrow();
    else
      expect(run).toThrow(
        expect.objectContaining({ code: 'SCHEDULE_BREAK_INVALID', details: { day: 0, start } }),
      );
  },
);
it.each([0, 6])('materializes overnight breaks on the next date, keeping start day %s', (day) => {
  const [shift] = materializeSchedule(
    week,
    [{ day, start: '20:00', end: '04:00', break_start: '00:30', break_end: '01:00' }],
    'Asia/Kuwait',
    3,
  );
  expect(shift).toMatchObject({
    working_date: addScheduleDays(week, day),
    break_starts_at: `${addScheduleDays(week, day)}T21:30:00.000Z`,
    break_ends_at: `${addScheduleDays(week, day)}T22:00:00.000Z`,
  });
});
it('normalises old patterns and keeps the full eight-hour shift with a break', () => {
  const [plain] = shifts();
  const [withBreak] = materializeSchedule(
    week,
    [{ day: 0, start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' }],
    'Asia/Kuwait',
    3,
  );
  expect(plain).toMatchObject({
    break_start: null,
    break_end: null,
    break_starts_at: null,
    break_ends_at: null,
  });
  expect(withBreak).toMatchObject({
    starts_at: plain?.starts_at,
    ends_at: plain?.ends_at,
    break_starts_at: `${week}T10:00:00.000Z`,
    break_ends_at: `${week}T11:00:00.000Z`,
  });
  if (!withBreak) throw new Error('Missing materialized shift');
  expect(Date.parse(withBreak.ends_at) - Date.parse(withBreak.starts_at)).toBe(8 * 60 * 60 * 1000);
});
it.each(['2026-03-28', '2026-10-24'])(
  'refuses a break in a Berlin DST gap or fold for week %s',
  (weekStart) => {
    expect(() =>
      materializeSchedule(
        weekStart,
        [{ day: 1, start: '00:00', end: '06:00', break_start: '02:15', break_end: '03:30' }],
        'Europe/Berlin',
        3,
      ),
    ).toThrow('SCHEDULE_LOCAL_TIME_INVALID');
  },
);
it('compares all ten past-shift values independently of key and array order', () => {
  const original = materializeSchedule(
    week,
    [{ day: 0, start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' }],
    'Asia/Kuwait',
    3,
  );
  for (const key of ['break_start', 'break_end', 'break_starts_at', 'break_ends_at'] as const) {
    const changed = original.map((s) => ({ ...s, [key]: `${s[key]}-changed` }));
    expect(() => requirePastScheduleReason(original, changed, '2026-10-04')).toThrow(
      'SCHEDULE_PAST_REASON_REQUIRED',
    );
  }
  for (const [before, after] of [
    [shifts(), original],
    [original, shifts()],
  ] as const) {
    expect(() => requirePastScheduleReason(before, after, '2026-10-04')).toThrow(
      'SCHEDULE_PAST_REASON_REQUIRED',
    );
    expect(() =>
      requirePastScheduleReason(before, after, '2026-10-04', 'Synthetic reason'),
    ).not.toThrow();
    expect(() => requirePastScheduleReason(before, after, week)).not.toThrow();
    expect(() => requirePastScheduleReason(before, after, '2026-10-02')).not.toThrow();
  }
  const before = [...original, ...shifts(1)];
  const reordered = [...before]
    .reverse()
    .map((s) => Object.fromEntries(Object.entries(s).reverse()) as typeof s);
  expect(() => requirePastScheduleReason(before, reordered, '2026-10-05')).not.toThrow();
});

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
      break_start: null,
      break_end: null,
      break_starts_at: null,
      break_ends_at: null,
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
    expect(() => validateScheduleOverlap(friday, saturday, 3, undefined, 'branch')).toThrow(
      'SCHEDULE_SHIFT_OVERLAP',
    );
    expect(() =>
      validateScheduleOverlap(
        friday,
        materializeSchedule('2026-10-10', pattern(0, '06:00', '08:00'), 'Asia/Kuwait', 3),
        3,
        undefined,
        'branch',
      ),
    ).not.toThrow();
    expect(() =>
      validateScheduleOverlap(
        shifts(),
        materializeSchedule(week, pattern(0, '10:00', '12:00'), 'Asia/Dubai', 3),
        3,
        undefined,
        'branch',
      ),
    ).toThrow('SCHEDULE_SHIFT_OVERLAP');
  });
  it('counts split shifts stored in the same branch', () =>
    expect(() =>
      validateScheduleOverlap(
        shifts(0, '01:00', '02:00'),
        [
          ...shifts(0, '03:00', '04:00'),
          ...shifts(0, '05:00', '06:00'),
          ...shifts(0, '07:00', '08:00'),
        ].map((s) => ({ ...s, branch_id: 'branch' })),
        3,
        undefined,
        'branch',
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
