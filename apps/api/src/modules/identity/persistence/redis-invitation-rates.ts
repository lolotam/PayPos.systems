import type { Redis } from 'ioredis';

import type { InvitationRateLimiter } from '../ports/member-invitations.port.ts';

const WINDOW_SECONDS = 60 * 60;
const LIMIT = 10;

// نافذة ثابتة على ساعة Redis نفسه، والعد والـ TTL في سكريبت واحد: مفيش ساعة تطبيق ولا مفتاح
// بيفضل من غير انتهاء لو العملية قفلت بين الأمرين (نفس أسلوب حد OTP في redis-otp-rates).
const ADMIT = `
local t = redis.call('TIME')
local bucket = math.floor(t[1] / tonumber(ARGV[1]))
local key = KEYS[1] .. ':' .. bucket
local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, tonumber(ARGV[1]))
end
if count > tonumber(ARGV[2]) then return 0 end
return 1`;

/**
 * بيحدّ عدّ الدعوات لكل مالك: عشر دعوات في الساعة. المسار مملوك للمالك، فمفيش حد يقدر
 * يستنزف رصيد حد تاني (plan §5).
 *
 * @param redis عميل Redis
 * @returns مُعدّل الدعوات
 */
export function createInvitationRateLimiter(redis: Redis): InvitationRateLimiter {
  return {
    allow: async (ownerUserId) =>
      (await redis.eval(ADMIT, 1, `identity:invitations:${ownerUserId}`, WINDOW_SECONDS, LIMIT)) ===
      1,
  };
}
