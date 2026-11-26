import type { OwnServiceLine } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { formatBusinessDate, formatBusinessDateTime, formatBusinessTime } from '@/shared/datetime/business-time';

/**
 * هل عمود الخدمة جاي في الصف؟ العمود الممنوع غايب من الرد مش null (MY-02).
 *
 * @param item صف «شغلي» من الـ API
 * @returns true لو أي من اسمي الخدمة موجود
 */
export function hasService(item: OwnServiceLine): boolean {
  return item.service_name_en !== undefined || item.service_name_ar !== undefined;
}

/**
 * اسم الخدمة بلغة العرض؛ الاسم العربي ممكن يبقى null مع إن العمود مسموح، فبنرجع للإنجليزي.
 *
 * @param item صف فيه عمود الخدمة
 * @param locale لغة العرض
 * @returns الاسم للعرض
 */
export function serviceName(item: OwnServiceLine, locale: Locale): string {
  const arabic = item.service_name_ar;
  return locale === 'ar' && arabic ? arabic : (item.service_name_en ?? arabic ?? '');
}

/**
 * اسم الفرع بلغة العرض (الفرع بيظهر دايماً، حتى لو كل الأعمدة مخفية).
 *
 * @param item صف «شغلي»
 * @param locale لغة العرض
 * @returns اسم الفرع
 */
export function branchName(item: OwnServiceLine, locale: Locale): string {
  return locale === 'ar' && item.branch_name_ar ? item.branch_name_ar : item.branch_name_en;
}

/**
 * نصيب الموظفة من الخدمة كنسبة مئوية من النقاط الأساسية: 5000 ← "50%"، 3333 ← "33.33%".
 *
 * @param bps نقاط أساسية من 0 لـ 10000
 * @returns النسبة للعرض بأرقام لاتينية
 */
export function formatShare(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const rest = bps % 100;
  return rest === 0 ? `${whole}%` : `${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}%`;
}

/** تاريخ يوم العمل المحفوظ؛ الدالة نفسها في `shared/datetime/business-time` وبتتصدّر هنا لشاشات «شغلي». */
export { formatBusinessDate };

/**
 * ساعة الخدمة بالدقيقة بتوقيت النشاط دايماً، على الموبايل الشخصي وعلى جهاز الاستقبال، ومن غير
 * ما توقيت الجهاز يدخل (AC-57-4-9). التوقيت جاي من رد «شغلي» نفسه؛ لو الجهاز مش عارفه بتتعرض بـ UTC مكتوب جنبها.
 *
 * @param instant لحظة الخدمة
 * @param locale لغة العرض
 * @param timeZone اسم IANA لتوقيت النشاط من الرد
 * @returns الساعة للعرض
 */
export function formatLineTime(instant: string, locale: Locale, timeZone: string): string {
  return formatBusinessTime(instant, locale, timeZone);
}

/**
 * يوم إلغاء الخدمة بتوقيت النشاط دايماً، زي `formatLineTime` (AC-57-4-9).
 *
 * @param instant لحظة الإلغاء
 * @param locale لغة العرض
 * @param timeZone اسم IANA لتوقيت النشاط من الرد
 * @returns التاريخ للعرض
 */
export function formatCancelledOn(instant: string, locale: Locale, timeZone: string): string {
  return formatBusinessDateTime(instant, locale, timeZone);
}
