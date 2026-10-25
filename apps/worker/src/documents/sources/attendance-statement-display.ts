import { formatDate, formatTime, localDate, type Locale } from '@pospay/i18n';

/**
 * لحظة noon لتاريخ محلي في منطقة الفرع. اليوم في البيان يوم عمل بالفرع، والـ UTC مش
 * نفس اليوم في كل المناطق، فبنحسب فرق اليوم عند اللحظة المرشحة وبنصحّحها بيوم كامل.
 *
 * @param date يوم العمل بالفرع بصيغة YYYY-MM-DD
 * @param timeZone منطقة الفرع
 * @returns لحظة عند noon بالتوقيت المحلي لذلك اليوم
 */
function localDateInstant(date: string, timeZone: string): Date {
  const noon = new Date(`${date}T12:00:00Z`);
  const local = localDate(noon, timeZone);
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${local}T00:00:00Z`)) / 86_400_000,
  );
  return new Date(noon.getTime() + days * 86_400_000);
}

/**
 * تاريخ يوم العمل بصيغة للطباعة: ميلادي وبلغة الطلب (FR-015).
 *
 * @param date يوم العمل بالفرع بصيغة YYYY-MM-DD
 * @param language لغة الطلب
 * @param timeZone منطقة الفرع
 * @returns التاريخ للطباعة
 */
export function formatLocalDate(date: string, language: Locale, timeZone: string): string {
  return formatDate(localDateInstant(date, timeZone), {
    locale: language,
    calendar: 'gregorian',
    timeZone,
  });
}

/**
 * وقت بالساعة والدقيقة بس. منسق i18n بيطلع بالثواني، والجدول بيطبع HH:MM.
 *
 * @param instant اللحظة بالـ UTC
 * @param language لغة الطلب
 * @param timeZone منطقة الفرع
 * @returns الوقت بالـ HH:MM
 */
export function formatClockTime(instant: Date, language: Locale, timeZone: string): string {
  return formatTime(instant, { locale: language, timeZone }).slice(0, 5);
}

/**
 * تاريخ ووقت الإصدار: لحظة التجهيز في منطقة الفرع (FR-016).
 *
 * @param instant لحظة التجهيز
 * @param language لغة الطلب
 * @param timeZone منطقة الفرع
 * @returns التاريخ والوقت للطباعة
 */
export function formatIssuedAt(instant: Date, language: Locale, timeZone: string): string {
  const date = formatDate(instant, { locale: language, calendar: 'gregorian', timeZone });
  return `${date} ${formatClockTime(instant, language, timeZone)}`;
}
