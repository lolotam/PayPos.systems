/** عمر رابط التقييم سبعة أيام من لحظة المطالبة، وهو نفس المدة التي يفرضها قيد قاعدة البيانات (ADR-0011 §1، D-B5). */
export const RATING_LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * يحسب آخر لحظة يبقى فيها رابط التقييم صالحاً.
 *
 * @param now لحظة المطالبة
 * @returns لحظة انتهاء الصلاحية
 */
export function expiresAt(now: Date): Date {
  return new Date(now.getTime() + RATING_LINK_LIFETIME_MS);
}
