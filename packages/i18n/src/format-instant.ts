import type { Locale } from './catalog.js';

/**
 * بيعرض لحظة كاملة بالنطاق الزمني الفعلي للفرع، مع الثواني عشان انتهاء الصلاحية واضح.
 *
 * @param instant الوقت المخزن بالـ UTC
 * @param locale لغة العرض
 * @param timeZone نطاق الفرع، أو UTC لو الشاشة على مستوى الشركة
 * @returns تاريخ ووقت ومعهما اسم النطاق الزمني
 */
export function formatInstant(instant: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(instant);
}
