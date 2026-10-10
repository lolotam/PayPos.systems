import { expect, it } from 'vitest';
import {
  applyTemplateInput,
  concreteShift,
  scheduleShift,
  schedulePattern,
  shiftTemplate,
  setScheduleInput,
  templateListQuery,
  templateTerms,
} from '../staff/schedules.js';
const id = '01920000-0000-7000-8000-000000000101';
const shift = { day: 0, start: '09:00', end: '17:00' };
it.each([{}, { break_start: null, break_end: null }, { break_start: '13:00', break_end: '14:00' }])(
  'accepts optional paired break fields %j',
  (fields) => {
    expect(scheduleShift.parse({ ...shift, ...fields })).toEqual({ ...shift, ...fields });
  },
);
it.each([
  { break_start: '13:00' },
  { break_end: '14:00' },
  { break_start: '13:00', break_end: null },
  { break_start: null, break_end: '14:00' },
  { break_start: '24:00', break_end: '14:00' },
  { break_start: '9:00', break_end: '14:00' },
  { break_start: '13:00', break_end: '14:00', unknown: true },
])('refuses incomplete, malformed or unknown break fields %j', (fields) => {
  expect(scheduleShift.safeParse({ ...shift, ...fields }).success).toBe(false);
});
it('requires all four nullable break response keys and valid instants', () => {
  const value = {
    ...shift,
    working_date: '2026-10-10',
    starts_at: '2026-10-10T06:00:00Z',
    ends_at: '2026-10-10T14:00:00Z',
    break_start: null,
    break_end: null,
    break_starts_at: null,
    break_ends_at: null,
  };
  expect(concreteShift.parse(value)).toEqual(value);
  for (const key of ['break_start', 'break_end', 'break_starts_at', 'break_ends_at']) {
    const missing = Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
    expect(concreteShift.safeParse(missing).success).toBe(false);
  }
  expect(concreteShift.safeParse({ ...value, break_starts_at: '13:00' }).success).toBe(false);
});
it('carries breaks in templates and preserves the 28-shift bound', () => {
  const shifts = [{ ...shift, break_start: '13:00', break_end: '14:00' }];
  expect(templateTerms.parse({ name_en: 'Synthetic break', shifts }).shifts).toEqual(shifts);
  expect(
    shiftTemplate.parse({
      id,
      business_id: id,
      name_en: 'Synthetic break',
      name_ar: null,
      shifts,
      revision: 1,
      archived_at: null,
    }).shifts,
  ).toEqual(shifts);
  expect(schedulePattern.safeParse(Array.from({ length: 28 }, () => shift)).success).toBe(true);
  expect(schedulePattern.safeParse(Array.from({ length: 29 }, () => shift)).success).toBe(false);
});
it('lets oversized unique employee selections reach the named domain refusal', () => {
  const employee_ids = Array.from(
    { length: 21 },
    (_, i) => `01920000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
  );
  expect(
    applyTemplateInput.parse({ branch_id: id, employee_ids, weeks: ['2026-10-03'] }).employee_ids,
  ).toHaveLength(21);
});
it('validates strict schedule dates, local times, shift limits and revision tokens', () => {
  const valid = {
    week_start: '2026-10-03',
    expected_revision: 0,
    shifts: [{ day: 6, start: '22:00', end: '06:00' }],
  };
  expect(setScheduleInput.parse(valid)).toEqual(valid);
  for (const input of [
    { ...valid, company_id: id },
    { ...valid, expected_revision: -1 },
    { ...valid, week_start: '2026-02-30' },
    { ...valid, reason: ' ' },
    { ...valid, shifts: [{ day: 0, start: '24:00', end: '09:00' }] },
  ])
    expect(setScheduleInput.safeParse(input).success).toBe(false);
});
it('validates business template names, typed cursor and explicit unique apply targets', () => {
  expect(templateTerms.parse({ name_en: ' Synthetic ', shifts: [] }).name_en).toBe('Synthetic');
  expect(templateTerms.safeParse({ name_en: '', shifts: [] }).success).toBe(false);
  expect(templateListQuery.safeParse({ cursor: 'not-a-uuid' }).success).toBe(false);
  const base = { branch_id: id, employee_ids: [id], weeks: ['2026-10-03'] };
  expect(applyTemplateInput.parse(base).replace).toBe(false);
  expect(applyTemplateInput.safeParse({ ...base, employee_ids: [id, id] }).success).toBe(false);
  expect(
    applyTemplateInput.safeParse({ ...base, weeks: Array.from({ length: 13 }, () => '2026-10-03') })
      .success,
  ).toBe(false);
  expect(applyTemplateInput.safeParse({ ...base, employee_ids: [] }).success).toBe(false);
});
