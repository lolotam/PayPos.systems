import { expect, it } from 'vitest';
import { linkedOn, sameDefaultShifts, validateDefaultShifts } from '../employee-default-shifts.ts';
const shift = { day: 0, start: '09:00', end: '17:00' };
it('allows empty and overnight defaults', () => {
  expect(validateDefaultShifts([])).toEqual([]);
  expect(validateDefaultShifts([{ ...shift, start: '22:00', end: '06:00' }])).toHaveLength(1);
});
it.each([
  [[shift, shift], 'SCHEDULE_DAY_LIMIT_EXCEEDED'],
  [[{ ...shift, end: '02:00' }], 'SCHEDULE_SHIFT_INVALID'],
  [[{ ...shift, break_start: '09:00', break_end: '10:00' }], 'SCHEDULE_BREAK_INVALID'],
  [[{ ...shift, break_start: '16:00', break_end: '18:00' }], 'SCHEDULE_BREAK_INVALID'],
] as const)('refuses invalid defaults with %s', (shifts, code) => {
  expect(() => validateDefaultShifts(shifts)).toThrow(code);
});
it('compares sets without order or optional-null differences', () => {
  const other = { ...shift, day: 1 };
  expect(sameDefaultShifts([shift, other], [other, { ...shift, break_start: null, break_end: null }])).toBe(true);
  expect(sameDefaultShifts([shift], [{ ...shift, end: '18:00' }])).toBe(false);
});
it('uses inclusive from and exclusive to, with a null open end', () => {
  const links = [{ branch_id: 'a', from: '2026-10-01', to: '2026-10-10' }, { branch_id: 'b', from: '2026-10-10', to: null }];
  expect(linkedOn(links, 'a', '2026-10-01')).toBe(true);
  expect(linkedOn(links, 'a', '2026-10-10')).toBe(false);
  expect(linkedOn(links, 'b', '2026-10-10')).toBe(true);
  expect(linkedOn(links, 'b', '2026-10-09')).toBe(false);
});
