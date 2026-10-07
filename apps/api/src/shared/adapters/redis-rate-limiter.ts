import type { Redis } from 'ioredis';

import type { RateLimiter } from '../ports/rate-limiter.port.ts';

function rateName(kind: 'count' | 'done', key: string): string {
  return kind === 'done' ? `rate:done:${key}` : `rate:${key}`;
}

/**
 * @param redis the API's Redis client
 * @returns a fixed-window limiter: INCR, and the window's expiry set on its first hit
 */
export function createRedisRateLimiter(redis: Redis): RateLimiter {
  return {
    hit: async (key, limit, windowSeconds) => {
      const name = rateName('count', key);
      const [[, count]] = (await redis
        .multi()
        .incr(name)
        .expire(name, windowSeconds, 'NX')
        .exec()) as [[Error | null, number], [Error | null, number]];
      return count <= limit;
    },
    remember: (key, windowSeconds) =>
      redis.set(rateName('done', key), '1', 'EX', windowSeconds).then(() => undefined),
    remembered: async (key) => (await redis.get(rateName('done', key))) === '1',
    count: async (key) => {
      const raw = await redis.get(rateName('count', key));
      if (raw === null) return 0;
      if (!/^\d+$/.test(raw)) throw new Error('RATE_COUNT_UNREADABLE');
      return Number(raw);
    },
    remaining: async (key) => {
      const ttl = await redis.ttl(rateName('count', key));
      return ttl > 0 ? ttl : 0;
    },
  };
}
