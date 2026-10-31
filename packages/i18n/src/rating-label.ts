import { t, type Locale } from './catalog.js';

/**
 * أقصى طول لنص تسمية التقييم، بوحدات UTF-16 (نفس وحدة عدّ Zod).
 * الحد ده نسخة محلية من حدّ معامل الإشعار في `packages/contracts/src/notifications.ts`:
 * الحزمة دي ما بتستوردش العقد (مفيش اعتماد من i18n على contracts)، فالسقف مكتوب هنا
 * بنفس القيمة، والتطابق مع العقد بيتأكد في اختبار على حدّ العامل، مكان الاعتمادتين مع بعض.
 */
export const RATING_LABEL_TEXT_MAX = 255;

/**
 * علامة القص في نص الرسالة: بتقول للقارئ إن النص اتقصّ بدل ما يبان اسم ناقص.
 * هي نص واحد في اللغتين، فمش محتاجة مدخل في الكتالوج.
 */
const ELLIPSIS = '…';

/**
 * بيقصّ النص على حدود الـ code points، فما بيقعش نص من نص (نص UTF-16 نص نص).
 * الحد بيتحسب بوحدات UTF-16 عشان يبقى نفس وحدة عدّ Zod في حدّ معامل الإشعار.
 *
 * @param value النص كما هو
 * @param units أقصى عدد وحدات UTF-16 مسموح
 * @returns النص مقصوصاً على حدود الـ code points
 */
function cutAtCodePoint(value: string, units: number): string {
  let used = 0;
  let end = 0;
  for (const character of value) {
    const size = character.length;
    if (used + size > units) break;
    used += size;
    end += size;
  }
  return value.slice(0, end);
}

/**
 * بيقصّ نصاً لحدّ معامل الإشعار مع علامة القص، من غير ما يكسر زوج بديل.
 *
 * @param value النص الأصلي
 * @param units أقصى طول مقبول بوحدات UTF-16
 * @returns النص مقصوصاً وبه علامة القص
 */
function shorten(value: string, units: number): string {
  if (units <= 0) return '';
  return `${cutAtCodePoint(value, units - ELLIPSIS.length)}${ELLIPSIS}`;
}

/**
 * أقصى طول لكل اسم على قد التساوي: الاسم الأطول بينقص والاسم القصير ما يتقصش،
 * فكل الأسماء بتفضل ظاهرة في الرسالة.
 *
 * @param names الأسماء كما تُعرض
 * @param separatorLength طول الفاصل بين الأسماء
 * @returns السقف المشترك لكل اسم بوحدات UTF-16
 */
function fairShareCap(names: readonly string[], separatorLength: number): number {
  const overhead = (names.length - 1) * separatorLength;
  const total = (cap: number): number =>
    names.reduce((sum, name) => sum + Math.min(name.length, cap), overhead);
  let low = 0;
  let high = RATING_LABEL_TEXT_MAX;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (total(middle) <= RATING_LABEL_TEXT_MAX) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * اسم النشاط كمعامل مستقل في رسالة التقييم. الأسماء العادية تبقى كما هي، والزائد عن حدّ
 * العقد يُقصّ على حدود code points حتى لا ينكسر حرف مكمّل أو يفشل بناء الحمولة كلها.
 *
 * @param businessName اسم النشاط بعد اختيار اللغة والرجوع للإنجليزية
 * @returns الاسم الأصلي، أو مختصراً بعلامة قص داخل حدّ معامل الإشعار
 */
export function ratingBusinessName(businessName: string): string {
  if (businessName.length <= RATING_LABEL_TEXT_MAX) return businessName;
  return shorten(businessName, RATING_LABEL_TEXT_MAX);
}

/**
 * تسمية الفريق في رسالة طلب التقييم: اسم النشاط بين بادئة اللغة ولاحقتها.
 * البادئة واللاحقة في الكتالوج لأن ترتيب الكلمات حول الاسم بيختلف بين اللغات.
 * لو النص عدّى حدّ معامل الإشعار، الاسم بس هو اللي بيتقص والبادئة واللاحقة بيفضلوا زي ما هم.
 *
 * @param locale لغة العميل
 * @param businessName اسم النشاط كما هو معروض
 * @returns تسمية الفريق بنص الرسالة
 */
export function ratingTeamLabel(locale: Locale, businessName: string): string {
  const prefix = t(locale, 'ratingRequest.teamPrefix');
  const suffix = t(locale, 'ratingRequest.teamSuffix');
  const label = `${prefix}${businessName}${suffix}`;
  if (label.length <= RATING_LABEL_TEXT_MAX) return label;
  const room = RATING_LABEL_TEXT_MAX - prefix.length - suffix.length;
  if (room < 1) return cutAtCodePoint(label, RATING_LABEL_TEXT_MAX);
  return `${prefix}${shorten(businessName, room)}${suffix}`;
}

/**
 * أسماء المنفذين في رسالة طلب التقييم، مفصولين بفاصل اللغة.
 * لو النص عدّى حدّ معامل الإشعار، الأسماء الطويلة بتتقص على قد التساوي ولا واحد بيختفي.
 *
 * @param locale لغة العميل
 * @param names أسماء المنفذين كما تُعرض
 * @returns أسماء المنفذين بنص الرسالة
 */
export function ratingNamesLabel(locale: Locale, names: readonly string[]): string {
  const separator = t(locale, 'ratingRequest.namesSeparator');
  const label = names.join(separator);
  if (label.length <= RATING_LABEL_TEXT_MAX) return label;
  const cap = fairShareCap(names, separator.length);
  if (cap < 1) return cutAtCodePoint(label, RATING_LABEL_TEXT_MAX);
  return names.map((name) => (name.length > cap ? shorten(name, cap) : name)).join(separator);
}
