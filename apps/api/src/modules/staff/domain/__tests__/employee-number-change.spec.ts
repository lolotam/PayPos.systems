import { expect, it } from 'vitest';
import { employeeNumberChange } from '../employee-number-change.ts';

it('returns null when the stored number is already the requested number', () => {
  expect(employeeNumberChange(12, 12)).toBeNull();
});

it('records a real change from one stored number to another', () => {
  expect(employeeNumberChange(4, 9)).toEqual({
    before: { employee_number: 4 },
    after: { employee_number: 9 },
  });
});
