import type { Redis } from 'ioredis';
import type { GrantInvalidator } from '../ports/permission-overrides.port.ts';

export function createGrantInvalidator(redis?: Redis): GrantInvalidator {
  return {
    invalidate: async (companyId, membershipId) => {
      if (redis === undefined) return;
      const results = await redis
        .multi()
        .incr(`identity:grants:${companyId}:version`)
        .incr(`identity:grants:${companyId}:membership:${membershipId}:version`)
        .exec();
      if (results === null) throw new Error('Grant invalidation transaction aborted');
      for (const [error] of results) if (error !== null) throw error;
    },
  };
}
