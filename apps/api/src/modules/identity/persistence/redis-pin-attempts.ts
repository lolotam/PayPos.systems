import type { IdGenerator } from '@pospay/db';
import type { Redis } from 'ioredis';

import { PIN_LOCK_SECONDS, PIN_MAX_FAILURES } from '../domain/cashier-pin.ts';
import type { PinAttempts } from '../ports/cashier-pins.port.ts';

// A reservation outlives a stalled or crashed request by at most this long; a comparison takes well under a second.
const RESERVATION_MS = 60_000;

// KEYS: failures, reservations (a sorted set: member = reservation id, score = its deadline in ms), lock. Each script
// runs atomically, and reads the clock from Redis so every API instance agrees on it.
const NOW = `
  local t = redis.call('TIME')
  local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)`;
const RESERVE = `${NOW}
  if redis.call('EXISTS', KEYS[3]) == 1 then return 'locked' end
  local failures = tonumber(redis.call('GET', KEYS[1]) or '0')
  if failures + redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[2]) then return 'busy' end
  redis.call('ZADD', KEYS[2], now + tonumber(ARGV[3]), ARGV[1])
  redis.call('PEXPIRE', KEYS[2], ARGV[3])
  return 'ok'`;
// An expired reservation changes nothing: its slot was already given back, and its answer no longer counts.
const CLAIM = `${NOW}
  if redis.call('ZREM', KEYS[2], ARGV[1]) == 0 then return 'expired' end`;
const FAILED = `${CLAIM}
  local failures = redis.call('INCR', KEYS[1])
  if failures == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
  if failures >= tonumber(ARGV[2]) then
    redis.call('SET', KEYS[3], '1', 'EX', ARGV[3], 'NX')
    redis.call('DEL', KEYS[1])
    return 'locked'
  end
  return 'failed'`;
const SUCCEEDED = `${CLAIM}
  if redis.call('EXISTS', KEYS[3]) == 1 then return 'locked' end
  redis.call('DEL', KEYS[1])
  return 'ok'`;
const RELEASED = `${CLAIM}
  return 'ok'`;

const keys = (companyId: string, employeeId: string) => {
  const base = `pin:${companyId}:${employeeId}`;
  return [`${base}:failures`, `${base}:reservations`, `${base}:lock`];
};

/**
 * @param redis the API's Redis client
 * @param ids   the UUID v7 generator, naming each reservation
 * @returns PIN attempt counters: failures in a 15-minute window, one expiring reservation per comparison in flight,
 *          and a lock with its own expiry
 */
export function createRedisPinAttempts(redis: Redis, ids: IdGenerator): PinAttempts {
  const run = (script: string, target: { companyId: string; employeeId: string }, id: string) =>
    redis.eval(
      script,
      3,
      ...keys(target.companyId, target.employeeId),
      id,
      PIN_MAX_FAILURES,
      script === RESERVE ? RESERVATION_MS : PIN_LOCK_SECONDS,
    ) as Promise<string>;
  return {
    reserve: async (target) => {
      const id = ids.newId();
      const answer = (await run(RESERVE, target, id)) as 'ok' | 'locked' | 'busy';
      return answer === 'ok' ? { kind: 'ok', reservation: id } : { kind: answer };
    },
    failed: async (target, reservation) =>
      (await run(FAILED, target, reservation)) as 'failed' | 'locked' | 'expired',
    succeeded: async (target, reservation) =>
      (await run(SUCCEEDED, target, reservation)) as 'ok' | 'locked' | 'expired',
    release: async (target, reservation) => {
      await run(RELEASED, target, reservation);
    },
  };
}
