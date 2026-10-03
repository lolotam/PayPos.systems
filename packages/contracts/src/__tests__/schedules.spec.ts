import { expect, it } from 'vitest';
import {
  applyTemplateInput,
  setScheduleInput,
  templateListQuery,
  templateTerms,
} from '../staff/schedules.js';
const id = '01920000-0000-7000-8000-000000000101';
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
