import type { Redis } from 'ioredis';

import type { SettingsCache } from '../ports/settings.port.ts';

// Short on purpose: a read that raced a write and cached the old value is corrected within a minute at most.
const TTL_SECONDS = 60;
const key = (companyId: string, businessId: string) => `settings:${companyId}:${businessId}`;

/**
 * @param redis the API's Redis client
 * @returns the settings read cache, keyed by company and business
 */
export function createRedisSettingsCache(redis: Redis): SettingsCache {
  return {
    get: (companyId, businessId) => redis.get(key(companyId, businessId)),
    set: async (companyId, businessId, json) => {
      await redis.set(key(companyId, businessId), json, 'EX', TTL_SECONDS);
    },
    invalidate: async (companyId, businessId) => {
      await redis.del(key(companyId, businessId));
    },
  };
}
