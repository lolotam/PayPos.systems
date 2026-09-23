import { pbkdf2Sync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashCashierPin, verifyCashierPin } from '../cashier-pin.ts';

describe('cashier PIN hash', () => {
  it('is salted PBKDF2-SHA256 and never contains the PIN', async () => {
    const hash = await hashCashierPin('4821');
    expect(hash).toMatch(/^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(await hashCashierPin('4821')).not.toBe(hash);
  });

  it('verifies the right PIN and refuses a wrong one, a missing hash or a malformed hash', async () => {
    const hash = await hashCashierPin('4821');
    expect(await verifyCashierPin('4821', hash)).toBe(true);
    expect(await verifyCashierPin('4822', hash)).toBe(false);
    expect(await verifyCashierPin('4821', null)).toBe(false);
    expect(await verifyCashierPin('0000', null)).toBe(false);
    expect(await verifyCashierPin('4821', 'not-a-hash')).toBe(false);
    expect(await verifyCashierPin('4821', hash.replace('$600000$', '$0$'))).toBe(false);
  });

  it('reads the iteration count from the stored hash, so it can change without breaking old hashes', async () => {
    const salt = Buffer.alloc(16, 7);
    const key = pbkdf2Sync('4821', salt, 1000, 32, 'sha256');
    const old = `pbkdf2-sha256$1000$${salt.toString('base64url')}$${key.toString('base64url')}`;
    expect(await verifyCashierPin('4821', old)).toBe(true);
  });
});
