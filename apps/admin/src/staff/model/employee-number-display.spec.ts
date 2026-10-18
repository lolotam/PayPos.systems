import { expect, it } from 'vitest';
import { displayEmployeeNumber } from './employee-number-display';

it('shows plain digits and an em dash when the number is missing', () => {
  expect(displayEmployeeNumber(null)).toBe('\u2014');
  expect(displayEmployeeNumber(undefined)).toBe('\u2014');
  expect(displayEmployeeNumber(2)).toBe('2');
  expect(displayEmployeeNumber(1000)).toBe('1000');
});
