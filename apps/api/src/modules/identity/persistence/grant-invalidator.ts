import type { Redis } from 'ioredis';
import type { GrantInvalidator } from '../ports/permission-overrides.port.ts';

export function createGrantInvalidator(redis?: Redis): GrantInvalidator {
  return {
    invalidate: async (companyId) => {
      if (redis === undefined) return;
      await redis.incr(`identity:grants:${companyId}:version`);
    },
  };
}
