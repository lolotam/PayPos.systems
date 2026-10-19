import { expect, it } from 'vitest';
import { displayEmployeeNumber } from './employee-number-display';

it('shows plain digits', () => {
  expect(displayEmployeeNumber(2)).toBe('2');
  expect(displayEmployeeNumber(1000)).toBe('1000');
});
