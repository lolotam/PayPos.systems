import { randomInt } from 'node:crypto';

import type { Redis } from 'ioredis';

import type { Clock } from '../../../shared/ports/clock.port.ts';
import type { PairingCodes } from '../ports/devices.port.ts';

// 10 minutes, single use (Waleed, 2026-09-23). Eight characters from an alphabet without look-alikes (no 0/O, 1/I/L):
// 32^8 ≈ 10^12 codes, and the register route is rate-limited.
export const PAIRING_CODE_TTL_SECONDS = 600;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 8;
const key = (code: string) => `pairing:${code}`;

/**
 * @param redis the API's Redis client
 * @param clock the clock the expiry is reported against
 * @returns pairing codes kept in Redis, consumed with GETDEL so a code works once
 */
export function createRedisPairingCodes(redis: Redis, clock: Clock): PairingCodes {
  return {
    issue: async (target) => {
      for (;;) {
        const code = Array.from(
          { length: LENGTH },
          () => ALPHABET[randomInt(ALPHABET.length)],
        ).join('');
        const value = JSON.stringify({ companyId: target.companyId, branchId: target.branchId });
        // NX: a collision with a live code is retried, never overwritten.
        if ((await redis.set(key(code), value, 'EX', PAIRING_CODE_TTL_SECONDS, 'NX')) === 'OK') {
          return {
            code,
            expiresAt: new Date(clock.now().getTime() + PAIRING_CODE_TTL_SECONDS * 1000),
          };
        }
      }
    },
    consume: async (code) => {
      if (!/^[A-Z0-9]{8}$/.test(code)) return null;
      const value = await redis.getdel(key(code));
      if (value === null) return null;
      const parsed = JSON.parse(value) as { companyId: string; branchId: string };
      return { companyId: parsed.companyId, branchId: parsed.branchId };
    },
  };
}
