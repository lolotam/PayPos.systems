import { t, type Locale } from './catalog.js';

/**
 * تسمية الفريق في رسالة طلب التقييم: اسم النشاط بين بادئة اللغة ولاحقتها.
 * البادئة واللاحقة في الكتالوج لأن ترتيب الكلمات حول الاسم بيختلف بين اللغات.
 *
 * @param locale لغة العميل
 * @param businessName اسم النشاط كما هو معروض
 * @returns تسمية الفريق بنص الرسالة
 */
export function ratingTeamLabel(locale: Locale, businessName: string): string {
  const prefix = t(locale, 'ratingRequest.teamPrefix');
  const suffix = t(locale, 'ratingRequest.teamSuffix');
  return `${prefix}${businessName}${suffix}`;
}

/**
 * أسماء المنفذين في رسالة طلب التقييم، مفصولين بفاصل اللغة.
 *
 * @param locale لغة العميل
 * @param names أسماء المنفذين كما تُعرض
 * @returns أسماء المنفذين بنص الرسالة
 */
export function ratingNamesLabel(locale: Locale, names: readonly string[]): string {
  return names.join(t(locale, 'ratingRequest.namesSeparator'));
}
