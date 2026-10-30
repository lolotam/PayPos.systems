import type { Redis } from 'ioredis';

import { RateLimiterUnavailableError, type RateLimiter } from '../ports/rate-limiter.port.ts';

function rateName(kind: 'count' | 'done', key: string): string {
  return kind === 'done' ? `rate:done:${key}` : `rate:${key}`;
}

/** نتيجة أمر واحد جوه EXEC: خطأ الأمر في الخانة الأولى، ونتيجته في التانية. */
type ExecResult = readonly [error: unknown, result: unknown];

function isExecResult(value: unknown): value is ExecResult {
  return Array.isArray(value) && value.length === 2;
}

/** ردّ EXEC كامل: أمرين بالظبط، كل واحد في tuple من خطأ ونتيجة. */
function isExecEnvelope(value: unknown): value is readonly [ExecResult, ExecResult] {
  return (
    Array.isArray(value) && value.length === 2 && isExecResult(value[0]) && isExecResult(value[1])
  );
}

function isWindowCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

/** EXPIRE NX بيرجّع 1 لما ثبّت TTL، و0 لما المفتاح كان عنده TTL أصلاً — الاتنين سليمين. */
function isExpiryReply(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

/**
 * يقرأ عدد المحاولات من ردّ EXEC، ويرفض أي ردّ مش موثوق.
 * العدّ الغلط بيفتح الباب لطلبات فوق السقف، فالردّ الناقص بيتعامل معاه كإن Redis مش متاح.
 */
function readWindowCount(reply: unknown): number {
  if (!isExecEnvelope(reply)) throw new RateLimiterUnavailableError();
  const [incr, expire] = reply;
  if (incr[0] !== null || expire[0] !== null) throw new RateLimiterUnavailableError();
  const count = incr[1];
  if (!isWindowCount(count)) throw new RateLimiterUnavailableError();
  // حتى لو مش بنستعمل نتيجة EXPIRE في القرار، ردّها لازم يكون 0 أو 1: أي قيمة تانية معناها إن TTL الشباك مش مضمون.
  const expiry = expire[1];
  if (!isExpiryReply(expiry)) throw new RateLimiterUnavailableError();
  return count;
}

/**
 * يقرأ الثواني الباقية من ردّ TTL. Redis بيرجّع عدداً غير سالب، أو -1 لمفتاح من غير انتهاء، أو -2 لمفتاح
 * مش موجود — والاتنين يعنيان إن مفيش حاجة باقية. أي ردّ تاني مش مقروء، وهو مرفوض زي الردّ اللي مش
 * بنعرف نعدّه: الحدّ الغلط أحسن من إننا نفتح الباب.
 */
function readRemaining(ttl: unknown): number {
  if (typeof ttl !== 'number' || !Number.isSafeInteger(ttl))
    throw new RateLimiterUnavailableError();
  if (ttl >= 0) return ttl;
  if (ttl === -1 || ttl === -2) return 0;
  throw new RateLimiterUnavailableError();
}

/**
 * @param redis the API's Redis client
 * @returns a fixed-window limiter: INCR, and the window's expiry set on its first hit
 */
export function createRedisRateLimiter(redis: Redis): RateLimiter {
  return {
    hit: async (key, limit, windowSeconds) => {
      const name = rateName('count', key);
      const reply: unknown = await redis
        .multi()
        .incr(name)
        .expire(name, windowSeconds, 'NX')
        .exec();
      return readWindowCount(reply) <= limit;
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
      return readRemaining(ttl);
    },
  };
}
