import type { Redis } from 'ioredis';

import { PIN_LOCK_SECONDS, PIN_MAX_FAILURES } from '../domain/cashier-pin.ts';
import type { PinAttempts } from '../ports/cashier-pins.port.ts';

// A reservation outlives a crashed request by at most this long; a comparison takes well under a second.
const PENDING_SECONDS = 60;

// KEYS: failures, pending, lock. Each script runs atomically in Redis, so concurrent requests see one order.
const DECR_PENDING = `
  if tonumber(redis.call('GET', KEYS[2]) or '0') > 0 then redis.call('DECR', KEYS[2]) end`;
const RESERVE = `
  if redis.call('EXISTS', KEYS[3]) == 1 then return 'locked' end
  local failures = tonumber(redis.call('GET', KEYS[1]) or '0')
  local pending = tonumber(redis.call('GET', KEYS[2]) or '0')
  if failures + pending >= tonumber(ARGV[1]) then return 'busy' end
  redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], ARGV[2])
  return 'ok'`;
const FAILED = `${DECR_PENDING}
  local failures = redis.call('INCR', KEYS[1])
  if failures == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
  if failures >= tonumber(ARGV[1]) then
    redis.call('SET', KEYS[3], '1', 'EX', ARGV[2])
    redis.call('DEL', KEYS[1])
    return 'locked'
  end
  return 'failed'`;
const SUCCEEDED = `${DECR_PENDING}
  if redis.call('EXISTS', KEYS[3]) == 0 then redis.call('DEL', KEYS[1]) end
  return 'ok'`;
const RELEASED = `${DECR_PENDING}
  return 'ok'`;

const keys = (companyId: string, employeeId: string) => {
  const base = `pin:${companyId}:${employeeId}`;
  return [`${base}:failures`, `${base}:pending`, `${base}:lock`];
};

/**
 * @param redis the API's Redis client
 * @returns PIN attempt counters: failures in a 15-minute window, in-flight comparisons, and a lock with its own expiry
 */
export function createRedisPinAttempts(redis: Redis): PinAttempts {
  const run = (script: string, companyId: string, employeeId: string, ...args: number[]) =>
    redis.eval(script, 3, ...keys(companyId, employeeId), ...args) as Promise<string>;
  return {
    reserve: async (companyId, employeeId) =>
      (await run(RESERVE, companyId, employeeId, PIN_MAX_FAILURES, PENDING_SECONDS)) as
        'ok' | 'locked' | 'busy',
    failed: async (companyId, employeeId) =>
      (await run(FAILED, companyId, employeeId, PIN_MAX_FAILURES, PIN_LOCK_SECONDS)) as
        'failed' | 'locked',
    succeeded: async (companyId, employeeId) => {
      await run(SUCCEEDED, companyId, employeeId);
    },
    release: async (companyId, employeeId) => {
      await run(RELEASED, companyId, employeeId);
    },
  };
}
