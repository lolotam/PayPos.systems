import type { Redis } from 'ioredis';

import type { PushAdmission } from '../ports/push-admission.port.ts';

const RESERVE = `local n = redis.call('INCR', KEYS[1]);
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end;
if n <= tonumber(ARGV[1]) then return 1 end;
return 0`;

const LIMIT = 10;
const WINDOW_MS = 60_000;
const TIMEOUT_MS = 2_000;

// مهلة أمر Redis: عميل بيقبل الاتصال وما بي.replyش ما يقدرش يوقّف عامل الدفع.
async function within<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('PUSH_ADMISSION_TIMEOUT')), timeoutMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * يحجز سعة كل اشتراك دفع في نافذة زمنية.
 * القاعدة: مفتاح العدّاد هو معرّف الاشتراك وحده — ولا عنوان ولا مستخدم ولا هاتف — والحدّ
 * بيحمي من منتج عدّان؛ وخطأ Redis أو صمته بيتحوّل لسبب محدود من غير نص الخطأ.
 *
 * @param redis   عميل Redis
 * @param options الحدّ وطول النافذة ومهلة الأمر
 * @returns بوابة الحجز
 */
export function redisPushAdmission(
  redis: Pick<Redis, 'eval'>,
  options: { limit?: number; windowMs?: number; timeoutMs?: number } = {},
): PushAdmission {
  const limit = options.limit ?? LIMIT;
  const windowMs = options.windowMs ?? WINDOW_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs < 1 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  )
    throw new Error('PUSH_ADMISSION_CONFIG_INVALID');
  return {
    reserve: async (subscriptionId) => {
      const key = `push:admission:${subscriptionId}`;
      try {
        return (await within(redis.eval(RESERVE, 1, key, limit, windowMs), timeoutMs)) === 1;
      } catch {
        throw new Error('PUSH_ADMISSION_UNAVAILABLE');
      }
    },
  };
}
