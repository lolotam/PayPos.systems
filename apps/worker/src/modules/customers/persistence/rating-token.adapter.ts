import type { RatingTokenDeriver, RatingTokenPort } from '../ports/rating-token.port.ts';

/**
 * يربط كود الاشتقاق بالقدرة، ويفشل مغلقاً: بلا حلقة مفاتيح لا تُشتق بصمة ولا يُطالب بطلب.
 *
 * @param deriver كود الاشتقاق من جذر الـ worker، أو null لما القدرة غير جاهزة
 * @returns قدرة اشتقاق بصمة الرابط
 */
export function ratingTokenPort(deriver: RatingTokenDeriver | null): RatingTokenPort {
  return {
    claim: (identity) => deriver?.claim(identity) ?? null,
  };
}
