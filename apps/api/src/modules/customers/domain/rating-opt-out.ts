/**
 * قرار رفض التقييم: ثلاث حالات بس، وكلها موحّدة على الرد اللي بيروح للعميل (D-B10).
 * - `LINK_UNAVAILABLE`: الرابط مش موجود أو خلصت صلاحيته.
 * - `ALREADY_OPTED_OUT`: العميل رفض قبل كده، فمفيش كتابة تانية.
 * - `OPTED_OUT`: يرفض دلوقتي.
 */
export type RatingOptOutDecision = 'LINK_UNAVAILABLE' | 'ALREADY_OPTED_OUT' | 'OPTED_OUT';

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
  if (now.getTime() >= expiresAt.getTime()) return 'LINK_UNAVAILABLE';
  if (optedOutAt !== null) return 'ALREADY_OPTED_OUT';
  return 'OPTED_OUT';
}
