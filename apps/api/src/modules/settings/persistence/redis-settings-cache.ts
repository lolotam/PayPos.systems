import type { Redis } from 'ioredis';

import type { SettingsCache } from '../ports/settings.port.ts';

// Short on purpose, and only a backstop: correctness comes from the generation below, not from the expiry.
const TTL_SECONDS = 60;
// Outlives every cached entry, so a generation never restarts while an entry of an older one could still be read.
const GENERATION_TTL_SECONDS = 24 * 60 * 60;

// The generation is part of every entry's key, and a write bumps it after it commits: a read that raced the write and
// read the old row stores it under the generation it started with, where no later read looks.
const keys = (companyId: string, businessId: string) => {
  const base = `settings:${companyId}:${businessId}`;
  return { generation: `${base}:generation`, entry: (g: string) => `${base}:entry:${g}` };
};

/**
 * @param redis the API's Redis client
 * @returns the settings read cache, keyed by company, business and generation
 */
export function createRedisSettingsCache(redis: Redis): SettingsCache & {
  read(companyId: string, businessId: string): Promise<{ generation: string; json: string | null }>;
  fill(companyId: string, businessId: string, generation: string, json: string): Promise<void>;
} {
  return {
    read: async (companyId, businessId) => {
      const k = keys(companyId, businessId);
      const generation = (await redis.get(k.generation)) ?? '0';
      return { generation, json: await redis.get(k.entry(generation)) };
    },
    fill: async (companyId, businessId, generation, json) => {
      const k = keys(companyId, businessId);
      await redis.set(k.entry(generation), json, 'EX', TTL_SECONDS);
    },
    invalidate: async (companyId, businessId) => {
      const k = keys(companyId, businessId);
      await redis.multi().incr(k.generation).expire(k.generation, GENERATION_TTL_SECONDS).exec();
    },
  };
}
