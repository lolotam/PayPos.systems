// عدّاد كود الربط: كام ثانية فاضلة قبل ما الكود يخلص. دوال نقية عشان تتختبر من غير ساعة حقيقية.

/**
 * بيعمل عدّاد الدقائق والثواني بالشكل MM:SS، ويقف عند 00:00 لما الوقت خلص.
 *
 * @param remainingSeconds الثواني الفاضلة
 * @returns نص بالشكل MM:SS
 */
export function formatCountdown(remainingSeconds: number): string {
  const total = Number.isFinite(remainingSeconds) ? Math.max(0, Math.floor(remainingSeconds)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Seconds left before the code expires, never below zero.
 *
 * @param expiresAtIso وقت انتهاء الكود
 * @param nowMs         اللحظة الحالية بالـ ms
 * @returns الثواني الفاضلة
 */
export function remainingSecondsUntil(expiresAtIso: string, nowMs: number): number {
  const expiry = Date.parse(expiresAtIso);
  if (Number.isNaN(expiry)) return 0;
  return Math.max(0, Math.ceil((expiry - nowMs) / 1000));
}
