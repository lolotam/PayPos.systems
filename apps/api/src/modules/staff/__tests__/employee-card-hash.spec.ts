import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { createEmployeeCardHash } from '../persistence/employee-card-hash.ts';

it('uses a domain-separated keyed digest, trims scan edges and separates tenants and case', () => {
  const key = Buffer.alloc(32, 7);
  const hash = createEmployeeCardHash(key);
  const expected = createHmac('sha256', key)
    .update(JSON.stringify(['pospay:employee-card:lookup:v1', 'company-a', 'CARD-1']))
    .digest('hex');
  expect(hash('company-a', ' CARD-1 ')).toBe(expected);
  expect(hash('company-b', 'CARD-1')).not.toBe(expected);
  expect(hash('company-a', 'card-1')).not.toBe(expected);
  expect(createEmployeeCardHash(Buffer.alloc(32, 8))('company-a', 'CARD-1')).not.toBe(expected);
  expect(() => createEmployeeCardHash(Buffer.alloc(0))).toThrow('CARD_KEY_UNAVAILABLE');
});

it('separates lookup and every command even for identical input', () => {
  const hash = createEmployeeCardHash(Buffer.alloc(32, 7));
  const purposes = ['lookup', 'issue', 'revoke', 'clock'] as const;
  const digests = purposes.map((purpose) => hash('company-a', 'SYNTHETIC-COMMAND', purpose));
  expect(new Set(digests).size).toBe(4);
  expect(hash('company-a', 'SYNTHETIC-COMMAND', 'clock')).toBe(digests[3]);
});
