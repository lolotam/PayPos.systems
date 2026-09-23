import type { Redis } from 'ioredis';

import { PIN_LOCK_SECONDS } from '../domain/cashier-pin.ts';
import type { PinAttempts } from '../ports/cashier-pins.port.ts';

const key = (companyId: string, employeeId: string) => `pin-attempts:${companyId}:${employeeId}`;

/**
 * @param redis the API's Redis client
 * @returns PIN attempt counters: INCR per attempt, the window set on the first, restarted by the lock
 */
export function createRedisPinAttempts(redis: Redis): PinAttempts {
  return {
    reserve: async (companyId, employeeId) => {
      const name = key(companyId, employeeId);
      const [[, count]] = (await redis
        .multi()
        .incr(name)
        .expire(name, PIN_LOCK_SECONDS, 'NX')
        .exec()) as [[Error | null, number], [Error | null, number]];
      return count;
    },
    lock: async (companyId, employeeId) => {
      await redis.expire(key(companyId, employeeId), PIN_LOCK_SECONDS);
    },
    clear: async (companyId, employeeId) => {
      await redis.del(key(companyId, employeeId));
    },
  };
}
