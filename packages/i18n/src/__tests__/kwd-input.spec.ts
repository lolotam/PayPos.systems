import { expect, it } from 'vitest';
import { normalizeKwdInput } from '../kwd-input.js';

it.each([
  ['12.5', '12.500'],
  ['0', '0.000'],
  ['0.001', '0.001'],
  ['99999999999.999', '99999999999.999'],
  ['100000000000.000', '100000000000.000'],
  ['', ''],
  ['1.0001', '1.0001'],
  ['1e3', '1e3'],
])('normalizes %s without floating point to %s', (input, expected) => {
  expect(normalizeKwdInput(input)).toBe(expected);
});
