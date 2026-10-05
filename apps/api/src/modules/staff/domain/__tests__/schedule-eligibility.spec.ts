import { expect, it } from 'vitest';
import {
  materializeSchedule,
  requirePastScheduleReason,
  validateScheduleEmployeeWeek,
} from '../schedules.ts';
import type { SchedulingEmployee } from '../schedule-types.ts';
const week = '2026-10-03';
const employee: SchedulingEmployee = {
  id: 'synthetic',
  business_id: 'synthetic',
  hire_date: '2026-01-01',
  contract_end: null,
  deleted_at: null,
  attachments: [{ branch_id: 'branch', from: '2026-01-01', to: null }],
};
it.each([
  { ...employee, deleted_at: week },
  { ...employee, hire_date: '2026-10-10' },
  { ...employee, contract_end: '2026-10-02' },
  { ...employee, attachments: [] },
  { ...employee, attachments: [{ branch_id: 'other', from: week, to: null }] },
  { ...employee, attachments: [{ branch_id: 'branch', from: '2026-10-10', to: null }] },
  { ...employee, attachments: [{ branch_id: 'branch', from: '2026-01-01', to: week }] },
  {
    ...employee,
    hire_date: '2026-10-09',
    attachments: [{ branch_id: 'branch', from: week, to: '2026-10-09' }],
  },
])('hides a week without any eligible employment/attachment intersection: %j', (value) => {
  expect(() => validateScheduleEmployeeWeek(value, 'branch', week)).toThrow('NOT_FOUND');
});
it('accepts exactly one eligible day, including inclusive contract end and Friday hire', () => {
  const lastDay = {
    ...employee,
    hire_date: '2026-10-09',
    contract_end: '2026-10-09',
    attachments: [{ branch_id: 'branch', from: '2026-10-09', to: '2026-10-10' }],
  };
  expect(() => validateScheduleEmployeeWeek(lastDay, 'branch', week)).not.toThrow();
  expect(() =>
    validateScheduleEmployeeWeek({ ...employee, contract_end: week }, 'branch', week),
  ).not.toThrow();
});
it('compares canonical values regardless of key order, array order or unrelated fields', () => {
  const shifts = materializeSchedule(
    week,
    [
      { day: 0, start: '09:00', end: '12:00' },
      { day: 0, start: '14:00', end: '18:00' },
    ],
    'Asia/Kuwait',
  );
  const reordered = [...shifts].reverse().map((s) => ({
    ends_at: s.ends_at,
    start: s.start,
    working_date: s.working_date,
    day: s.day,
    end: s.end,
    starts_at: s.starts_at,
    unrelated: 'synthetic',
  }));
  expect(() => requirePastScheduleReason(reordered, shifts, '2026-10-05')).not.toThrow();
});
it.each(['day', 'working_date', 'start', 'end', 'starts_at', 'ends_at'] as const)(
  'requires a reason when canonical field %s actually changes',
  (field) => {
    const shifts = materializeSchedule(
      week,
      [{ day: 0, start: '09:00', end: '12:00' }],
      'Asia/Kuwait',
    );
    const before = shifts[0];
    if (!before) throw new Error('Synthetic shift missing');
    const changed = { ...before, [field]: field === 'day' ? 1 : 'synthetic changed value' };
    expect(() => requirePastScheduleReason(shifts, [changed], '2026-10-05')).toThrow(
      'SCHEDULE_PAST_REASON_REQUIRED',
    );
  },
);
