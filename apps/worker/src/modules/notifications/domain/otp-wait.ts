/**
 * الانتظار قصير ولا يمد مهلة التحضير المختارة قبل البحث عن الهاتف.
 *
 * @param now الساعة المحقونة
 * @param preparation الموعد الثابت للتحضير
 * @param expiry نهاية صلاحية الاعتماد
 * @returns مدة polling التالية أو صفر عندما ينتهي الانتظار
 */
export function otpPollDelay(now: Date, preparation: Date, expiry: Date): number {
  return Math.max(
    0,
    Math.min(5, preparation.getTime() - now.getTime(), expiry.getTime() - now.getTime()),
  );
}
