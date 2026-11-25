/** أصل صفحة التقييم المستخدم في تجارب البيئة غير الإنتاجية لما الإعداد غير مضبوط؛ نطاق .invalid لا يُحلّ أبداً فلا يخرج رابط حقيقي. */
export const FAKE_RATING_PAGE_ORIGIN = 'https://rating.example.invalid';

/**
 * يحدد أصل صفحة التقييم الذي يُركَّب عليه رابط الإرسال، ويفشل مغلقاً بـ null عند أي إعداد غير صالح.
 * الأصل الصالح بروتوكول http أو https وخادم فقط بلا مسار أو استعلام أو جزء أو بيانات دخول.
 * في الإنتاج أو الوضع الحي لازم يكون https صريحاً؛ وفي الوضع التجريبي غير الإنتاجي يرجع للأصل الوهمي لو الإعداد غير مضبوط أو فاضي.
 *
 * @param raw قيمة RATING_PAGE_ORIGIN كما هي من البيئة
 * @param strict true في الإنتاج أو الوضع الحي حيث لا بديل ولا http
 * @returns الأصل الصالح، أو null لما الإعداد ناقص أو مشوّه
 */
export function resolveRatingPageOrigin(raw: string | undefined, strict: boolean): string | null {
  if (raw === undefined || raw === '') return strict ? null : FAKE_RATING_PAGE_ORIGIN;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const schemeAllowed = strict
    ? parsed.protocol === 'https:'
    : parsed.protocol === 'https:' || parsed.protocol === 'http:';
  return schemeAllowed && parsed.origin === raw ? raw : null;
}
