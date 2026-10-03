import { expect, it } from 'vitest';
import { validateSalary, nextSalary, salarySnapshot } from '../set-salary.ts';
const terms = { effective_from: '2026-10-03', amount: '0.000', reason: ' Synthetic reason ' };
it('accepts zero, maximum amount, trimmed reason and any past/future date', () => {
  expect(validateSalary(terms)).toMatchObject({ amount: 0n, reason: 'Synthetic reason' });
  expect(
    validateSalary({ ...terms, amount: '99999999999.999', effective_from: '2099-01-01' }).amount,
  ).toBe(99999999999999n);
  expect(validateSalary({ ...terms, effective_from: '1900-01-01' }).effective_from).toBe(
    '1900-01-01',
  );
});
it.each(['-0.001', '-1.000', '1.00', '1.0000', '1e3', 'NaN', '100000000000.000', '01.000'])(
  'refuses invalid amount %s without printing it',
  (amount) => {
    expect(() => validateSalary({ ...terms, amount })).toThrow('VALIDATION_FAILED');
  },
);
it.each(['', '   ', 'a'.repeat(501)])('requires a bounded reason', (reason) =>
  expect(() => validateSalary({ ...terms, reason })).toThrow('VALIDATION_FAILED'),
);
it.each(['0000-01-01', '2026-02-30', '2025-02-29', '2026-1-01', 'invalid'])(
  'refuses invalid date %s',
  (effective_from) =>
    expect(() => validateSalary({ ...terms, effective_from })).toThrow('VALIDATION_FAILED'),
);
it('accepts leap day, preserves entry identity and increments unchanged replacement', () => {
  const first = nextSalary(
    null,
    validateSalary({ ...terms, effective_from: '2024-02-29' }),
    'id',
    'employee',
    'actor',
  );
  const second = nextSalary(first, validateSalary(terms), 'other-id', 'employee', 'second-actor');
  expect(second).toMatchObject({ id: 'id', revision: 2, set_by: 'second-actor' });
  expect(first.revision).toBe(1);
  expect(salarySnapshot(second).amount).toBe('0.000');
  expect(() =>
    nextSalary(
      { ...first, revision: 2147483647 },
      validateSalary(terms),
      'id',
      'employee',
      'actor',
    ),
  ).toThrow('VALIDATION_FAILED');
});
