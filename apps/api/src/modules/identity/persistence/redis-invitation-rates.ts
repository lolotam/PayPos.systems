import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

import { ApiError } from '../../../shared/errors.ts';
import type {
  InvitationLinkCoordinator,
  InvitationRateLimiter,
} from '../ports/member-invitations.port.ts';

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

const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

const LOCK_TTL_MS = 5_000;
const LOCK_RETRY_DELAY_MS = 25;
const LOCK_MAX_WAIT_MS = 150;

/**
 * ينسّق إصدار رابط الدعوة وختمه عبر مثيلات الـ API لنفس الدعوة باستخدام قفل Redis قصير الأمد،
 * حتى لا يسبق ختمٌ أقدم إصدارَ توكنٍ أحدث بين عمليات متعددة.
 *
 * @param redis عميل Redis المشترك
 * @returns منسّق القفل الموزّع
 */
export function createInvitationLinkCoordinator(redis: Redis): InvitationLinkCoordinator {
  return {
    run: async (companyId, invitationId, work) => {
      const key = `identity:invitations:link-lock:${companyId}:${invitationId}`;
      const token = randomBytes(16).toString('hex');
      const started = Date.now();
      for (;;) {
        const ok = await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
        if (ok === 'OK') break;
        if (Date.now() - started >= LOCK_MAX_WAIT_MS) throw new ApiError('TOO_MANY_REQUESTS');
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
      }
      try {
        return await work();
      } finally {
        await redis.eval(RELEASE_LOCK, 1, key, token).catch(() => undefined);
      }
    },
  };
}
