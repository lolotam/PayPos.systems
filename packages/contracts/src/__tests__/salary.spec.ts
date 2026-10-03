import { expect, it } from 'vitest';
import { setSalaryInput, salaryHistoryQuery } from '../staff/salary.js';
const terms = { effective_from: '2026-01-01', amount: '123.456', reason: ' synthetic ' };
it('trims mandatory reason and validates dates, amount precision and unknown claims', () => {
  expect(setSalaryInput.parse(terms).reason).toBe('synthetic');
  for (const input of [
    { ...terms, amount: 1 },
    { ...terms, amount: '-1.000' },
    { ...terms, amount: '1.00' },
    { ...terms, effective_from: '2026-02-29' },
    { ...terms, effective_from: '0000-01-01' },
    { ...terms, reason: '' },
    { ...terms, set_by: 'actor' },
  ])
    expect(setSalaryInput.safeParse(input).success).toBe(false);
  expect(salaryHistoryQuery.parse({})).toEqual({ limit: 20 });
  expect(salaryHistoryQuery.safeParse({ limit: 101 }).success).toBe(false);
  expect(salaryHistoryQuery.safeParse({ cursor: '0000-01-01' }).success).toBe(false);
});
