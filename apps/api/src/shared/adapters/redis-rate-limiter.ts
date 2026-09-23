import type { Redis } from 'ioredis';

import type { RateLimiter } from '../ports/rate-limiter.port.ts';

/**
 * @param redis the API's Redis client
 * @returns a fixed-window limiter: INCR, and the window's expiry set on its first hit
 */
export function createRedisRateLimiter(redis: Redis): RateLimiter {
  return {
    hit: async (key, limit, windowSeconds) => {
      const name = `rate:${key}`;
      const [[, count]] = (await redis
        .multi()
        .incr(name)
        .expire(name, windowSeconds, 'NX')
        .exec()) as [[Error | null, number], [Error | null, number]];
      return count <= limit;
    },
  };
}
