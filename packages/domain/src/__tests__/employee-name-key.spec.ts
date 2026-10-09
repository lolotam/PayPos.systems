import { expect, it } from 'vitest';
import { employeeNameMatchKey } from '../employee-name-key.js';
import {
  employeeNameKeyUnicodeCaseVectors,
  employeeNameKeyVectors,
} from './employee-name-key.vectors.js';

it.each(employeeNameKeyVectors)('normalizes %j to %j and is idempotent', (name, expected) => {
  const key = employeeNameMatchKey(name);
  expect(key).toBe(expected);
  expect(employeeNameMatchKey(key)).toBe(key);
});

it('requires the whole name rather than a prefix', () => {
  expect(employeeNameMatchKey('سارة')).not.toBe(employeeNameMatchKey('سارة أحمد'));
});

it.each(employeeNameKeyUnicodeCaseVectors)('uses Unicode case rules for %j', (name, expected) => {
  expect(employeeNameMatchKey(name)).toBe(expected);
});
