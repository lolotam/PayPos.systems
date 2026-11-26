import type { Locale } from '@pospay/i18n';

/**
 * الشهر اللي قبل شهر معين.
 *
 * @param month شهر بصيغة YYYY-MM
 * @returns الشهر السابق بنفس الصيغة
 */
export function previousMonth(month: string): string {
  const [year = 0, number = 1] = month.split('-').map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, '0')}`;
}

/**
 * الشهر اللي بعد شهر معين.
 *
 * @param month شهر بصيغة YYYY-MM
 * @returns الشهر التالي بنفس الصيغة
 */
export function nextMonth(month: string): string {
  const [year = 0, number = 1] = month.split('-').map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
}

/**
 * اسم الشهر للعرض، بالأرقام اللاتينية في اللغتين.
 *
 * @param month شهر بصيغة YYYY-MM
 * @param locale لغة العرض
 * @returns اسم الشهر والسنة
 */
export function monthLabel(month: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    calendar: 'gregory',
    numberingSystem: 'latn',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-15T12:00:00Z`));
}
