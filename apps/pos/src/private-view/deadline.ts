/** الوقت المتبقي اللي رجّعه السيرفر في رد الفتح أو اللمس، بالمللي ثانية. */
export type PrivateViewRemaining = {
  idle_remaining_ms: number;
  cap_remaining_ms: number;
};

/**
 * آخر مواعيد أكّدها السيرفر لنافذة العرض الخاص، بالساعة الرتيبة للتاب (performance.now).
 * `sentAt` لحظة إرسال الطلب اللي أكّدها: الحساب بيبدأ منها مش من لحظة وصول الرد، فالتاب
 * بيقفل دايماً قبل السيرفر أو معاه، مش بعده.
 */
export type PrivateViewDeadlines = {
  sentAt: number;
  idleAt: number;
  capAt: number;
};

/**
 * مواعيد النافذة من رد الفتح.
 *
 * @param sentAt لحظة إرسال طلب الفتح بالساعة الرتيبة
 * @param remaining الوقتين المتبقيين في رد الفتح
 * @returns أول مواعيد مؤكَّدة
 */
export function openedDeadlines(
  sentAt: number,
  remaining: PrivateViewRemaining,
): PrivateViewDeadlines {
  return {
    sentAt,
    idleAt: sentAt + remaining.idle_remaining_ms,
    capAt: sentAt + remaining.cap_remaining_ms,
  };
}

/**
 * مواعيد النافذة بعد لمسة نجحت. الخمول بياخد قيمة السيرفر نفسها، والسقف المطلق عمره ما بيتأجل:
 * بنقصّره بس. رد لمسة أقدم من لمسة مؤكَّدة بالفعل بيقصّر السقف ومبيحرّكش الخمول.
 *
 * @param current آخر مواعيد مؤكَّدة
 * @param sentAt لحظة إرسال اللمسة اللي نجحت
 * @param remaining الوقتين المتبقيين في ردها
 * @returns المواعيد الجديدة
 */
export function touchedDeadlines(
  current: PrivateViewDeadlines,
  sentAt: number,
  remaining: PrivateViewRemaining,
): PrivateViewDeadlines {
  const capAt = Math.min(current.capAt, sentAt + remaining.cap_remaining_ms);
  if (sentAt < current.sentAt) return { ...current, capAt };
  return { sentAt, idleAt: sentAt + remaining.idle_remaining_ms, capAt };
}

/**
 * اللحظة اللي الشاشة لازم تتقفل فيها: الأبكر بين موعد الخمول المؤكَّد من السيرفر والسقف المطلق وستين ثانية من آخر إدخال فعلي.
 * موعد السيرفر بيتحسب من إرسال آخر لمسة، واللمسة ممكن تتأجل لحد 20 ثانية بعد الإدخال، فلوحده كان هيمدّ العرض عن الستين.
 *
 * @param deadlines آخر مواعيد مؤكَّدة
 * @param inputExpiresAt لحظة انتهاء الخمول المحسوبة من آخر إدخال، أو بدونها لو مفيش حساب إدخال
 * @returns لحظة القفل بالساعة الرتيبة
 */
export function closeAt(deadlines: PrivateViewDeadlines, inputExpiresAt = Infinity): number {
  return Math.min(deadlines.idleAt, deadlines.capAt, inputExpiresAt);
}
