import type { Redis } from 'ioredis';

import type { PushAdmission } from '../ports/push-admission.port.ts';

const RESERVE = `local n = redis.call('INCR', KEYS[1]);
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end;
if n <= tonumber(ARGV[1]) then return 1 end;
return 0`;

const LIMIT = 10;
const WINDOW_MS = 60_000;

/**
 * يحجز سعة كل اشتراك دفع في نافذة زمنية.
 * القاعدة: مفتاح العدّاد هو معرّف الاشتراك وحده — ولا عنوان ولا مستخدم ولا هاتف — والحدّ
 * بيحمي من منتج عدّان؛ وخطأ Redis بيتحوّل لسبب محدود من غير نص الخطأ.
 *
 * @param redis   عميل Redis
 * @param options الحدّ وطول النافذة
 * @returns بوابة الحجز
 */
export function redisPushAdmission(
  redis: Pick<Redis, 'eval'>,
  options: { limit?: number; windowMs?: number } = {},
): PushAdmission {
  const limit = options.limit ?? LIMIT;
  const windowMs = options.windowMs ?? WINDOW_MS;
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1)
    throw new Error('PUSH_ADMISSION_CONFIG_INVALID');
  return {
    reserve: async (subscriptionId) => {
      const key = `push:admission:${subscriptionId}`;
      try {
        return (await redis.eval(RESERVE, 1, key, limit, windowMs)) === 1;
      } catch {
        throw new Error('PUSH_ADMISSION_UNAVAILABLE');
      }
    },
  };
}
