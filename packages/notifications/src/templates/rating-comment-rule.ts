// نسخة مطابقة لقاعدة storedRatingComment في packages/contracts/src/low-rating-notifications.ts، لأن الحزمة دي
// ما بتعتمدش على contracts ولا zod. اختبار التطابق في الـ worker (low-rating-template-parity.spec.ts) بيفشل لو
// النسختين اختلفوا على نفس العينة.
// الحدّان هنا نفس قيد قاعدة البيانات `ratings_comment_length` (1000 code point)، فمش أضيق منه ولا أوسع.
const MAX_CODE_POINTS = 1000;
const MAX_UTF16_UNITS = MAX_CODE_POINTS * 2;

/**
 * بيقرر هل التعليق المخزّن يقدر يسافر في جرس التقييم المنخفض: نص بأي محتوى بحد الطول بس.
 * مفيش فلتر روابط ولا markup هنا عن قصد: القاعدة دي بتقرا تعليقًا اتخزن فعلًا، والجرس بيعرضه نص متهرب (RT-Q17)،
 * فتشديد قاعدة الإرسال بعد كده ما يقدرش يخلي جرس يتلغي ولا صف مخزن يبطّل يتقرا.
 *
 * @param value القيمة كما وصلت في تفاصيل الجرس
 * @returns true لو القيمة نص لا يزيد عن 1000 code point
 */
export function storedCommentAllowed(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > MAX_UTF16_UNITS) return false;
  return Array.from(value).length <= MAX_CODE_POINTS;
}
