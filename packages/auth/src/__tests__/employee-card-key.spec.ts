import { expect, it } from 'vitest';
import { deriveEmployeeCardKey } from '../employee-card-key.ts';

it('derives a stable purpose-bound 32-byte subkey without handing out the auth root', () => {
  const root = 'synthetic-auth-root-for-card-tests';
  const key = deriveEmployeeCardKey(root);
  expect(Buffer.isBuffer(key)).toBe(true);
  expect(key).toHaveLength(32);
  expect(key.equals(Buffer.from(root))).toBe(false);
  expect(key.toString('hex')).toBe(
    'b8e4c0698d0ae51c5af8f8e7cd0f7c151330c60eb8e565cfcf4ad2a492169c42',
  );
  expect(deriveEmployeeCardKey(root)).toEqual(key);
  expect(deriveEmployeeCardKey('different-synthetic-auth-root-secret')).not.toEqual(key);
  expect(() => deriveEmployeeCardKey('')).toThrow('CARD_KEY_UNAVAILABLE');
});
