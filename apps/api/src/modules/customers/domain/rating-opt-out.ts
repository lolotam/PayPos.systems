/**
 * قرار رفض التقييم: ثلاث حالات بس، وكلها موحّدة على الرد اللي بيروح للعميل (D-B10).
 * - `LINK_UNAVAILABLE`: الرابط مش موجود أو خلصت صلاحيته.
 * - `ALREADY_OPTED_OUT`: العميل رفض قبل كده، فمفيش كتابة تانية.
 * - `OPTED_OUT`: يرفض دلوقتي.
 */
export type RatingOptOutDecision = 'LINK_UNAVAILABLE' | 'ALREADY_OPTED_OUT' | 'OPTED_OUT';

/**
 * بيحدد هل رابط التقييم انتهت صلاحيته عند اللحظة الممررة.
 * قاعدة العمل: الوصول للحظة `expires_at` نفسها يعني إن الرابط خلص، عشان قرار الصلاحية يفضل في مكان واحد.
 *
 * @param expiresAt لحظة انتهاء صلاحية رابط التقييم
 * @param now       اللحظة الحالية وقت فحص الصلاحية
 * @returns `true` لو `now` تساوي أو تتجاوز `expiresAt`، و`false` قبلها
 */
export function isRatingLinkExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/**
 * يقرر هل العميل بيرفض التقييم دلوقتي، بناءً على وقت انتهاء الرابط وحالة رفضه.
 * قاعدة العمل: الصلاحية بتتأكد الأول — لو الرابط خلص، يبقى مش متاح حتى لو العميل رفض قبل كده.
 * والوقت بالظبط عند الانتهاء يعني خلص (نهاية الشبكة الصالحة)، لأن `expires_at` هو الحد الأقصوى.
 *
 * @param expiresAt   لحظة انتهاء صلاحية رابط التقييم
 * @param now         اللحظة الحالية وقت القرار
 * @param optedOutAt  وقت رفض العميل للتقييم قبل كده، أو null لو ما رفضش
 * @returns القرار: الرابط مش متاح، أو العميل رفض قبل كده، أو يرفض دلوقتي
 */
export function ratingOptOutDecision(
  expiresAt: Date,
  now: Date,
  optedOutAt: Date | null,
): RatingOptOutDecision {
  if (isRatingLinkExpired(expiresAt, now)) return 'LINK_UNAVAILABLE';
  if (optedOutAt !== null) return 'ALREADY_OPTED_OUT';
  return 'OPTED_OUT';
}
