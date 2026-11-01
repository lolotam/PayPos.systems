// أدوات انتظار الحجز: وقت Redis الحقيقي، وانتظار انتهاء الحجز بدل نوم ثابت.
import type { Redis } from 'ioredis';

import type { RatingClaimState } from '../../ports/rating-claim-state.port.ts';

/** وقت Redis الحالي بالمللي ثانية؛ الحجز بيتقاس بوقت Redis مش بساعة الجهاز. */
export async function serverNowMs(redis: Redis): Promise<number> {
  const [seconds, micros] = await redis.time();
  return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
}

/**
 * ينتظر انتهاء حجز المالك بحد أعلى، بدل نوم ثابت.
 *
 * @param state منفذ حالة الجدولة
 * @param companyId الشركة المالكة للحالة
 * @param redis اتصال Redis
 */
export async function waitForLeaseExpiry(
  state: RatingClaimState,
  companyId: string,
  redis: Redis,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const read = await state.read(companyId);
    const leaseUntil = read.value?.leaseUntil;
    if (leaseUntil === undefined) return;
    if (leaseUntil <= (await serverNowMs(redis))) return;
    if (Date.now() > deadline) throw new Error('RATING_CLAIM_LEASE_NOT_EXPIRED');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
