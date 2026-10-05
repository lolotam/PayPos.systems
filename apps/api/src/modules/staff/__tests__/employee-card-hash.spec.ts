import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { createEmployeeCardHash } from '../persistence/employee-card-hash.ts';

it('uses a domain-separated keyed digest, trims scan edges and separates tenants and case', () => {
  const secret = 'synthetic-server-key-for-card-hmac-tests';
  const hash = createEmployeeCardHash(secret);
  const key = createHmac('sha256', secret).update('pospay:employee-card:key:v1').digest();
  const expected = createHmac('sha256', key)
    .update(JSON.stringify(['pospay:employee-card:v1', 'company-a', 'CARD-1']))
    .digest('hex');
  expect(hash('company-a', ' CARD-1 ')).toBe(expected);
  expect(hash('company-b', 'CARD-1')).not.toBe(expected);
  expect(hash('company-a', 'card-1')).not.toBe(expected);
  expect(
    createEmployeeCardHash('different-synthetic-server-key-for-tests')('company-a', 'CARD-1'),
  ).not.toBe(expected);
  expect(() => createEmployeeCardHash('')).toThrow('CARD_KEY_UNAVAILABLE');
});
