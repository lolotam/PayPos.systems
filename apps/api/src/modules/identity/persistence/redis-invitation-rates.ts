import type { Redis } from 'ioredis';

import type { InvitationRateLimiter } from '../ports/member-invitations.port.ts';

const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 10;

/**
 * بيحدّ عدّ الدعوات لكل مالك: عشر دعوات في الساعة. المسار مملوك للمالك، فمفيش حد يقدر
 * يستنزف رصيد حد تاني (plan §5).
 *
 * @param redis عميل Redis
 * @returns مُعدّل الدعوات
 */
export function createInvitationRateLimiter(redis: Redis): InvitationRateLimiter {
  return {
    allow: async (ownerUserId) => {
      const window = Math.floor(Date.now() / WINDOW_MS);
      const key = `identity:invitations:${ownerUserId.toLowerCase()}:${window}`;
      const count = await redis.incr(key);
      if (count === 1) await redis.pexpire(key, WINDOW_MS);
      return count <= LIMIT;
    },
  };
}
