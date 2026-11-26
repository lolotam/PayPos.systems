import { formatDate, type Locale } from '@pospay/i18n';

/**
 * منسّق بتوقيت النشاط. التوقيت جاي من السيرفر وممكن يبقى اسم IANA جديد على متصفح أو WebView قديم، فالمنسّق بيرمي RangeError.
 * بدل ما الشاشة كلها تقع بنرجع لـ UTC ومعاه اسمه ظاهر في النص، وعمره ما بنرجع لتوقيت الجهاز (AC-57-4-9).
 *
 * @param locale لغة العرض
 * @param timeZone اسم IANA لتوقيت النشاط
 * @param options حقول التنسيق بتوقيت النشاط
 * @param fallback حقول التنسيق لو التوقيت مش معروف؛ فيها الساعة عشان اسم UTC يتكتب جنب لحظة واضحة (dateStyle لوحده ما بيقبلش اسم التوقيت)
 * @returns المنسّق
 */
function businessFormatter(
  locale: Locale,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
  fallback: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, numberingSystem: 'latn', ...options });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      timeZoneName: 'short',
      numberingSystem: 'latn',
      ...fallback,
    });
  }
}

const TIME_FIELDS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
};

/**
 * ساعة اللحظة بتوقيت النشاط دايماً، ومن غير ما توقيت الجهاز يدخل (AC-57-4-9). لو التوقيت مش معروف
 * (مالوش، أو اسم IANA مش عارفه هذا المتصفح) بتتعرض بـ UTC مكتوب جنبها.
 *
 * @param instant اللحظة
 * @param locale لغة العرض
 * @param timeZone اسم IANA لتوقيت النشاط، أو undefined لو مش معروف
 * @returns الساعة للعرض
 */
export function formatBusinessTime(
  instant: string,
  locale: Locale,
  timeZone: string | undefined,
): string {
  if (timeZone === undefined)
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      timeZoneName: 'short',
      numberingSystem: 'latn',
      ...TIME_FIELDS,
    }).format(new Date(instant));
  return businessFormatter(locale, timeZone, TIME_FIELDS, TIME_FIELDS).format(new Date(instant));
}

/**
 * تاريخ يوم العمل المحفوظ؛ UTC حامل للتنسيق بس عشان المتصفح ما يعيد تفسير اليوم.
 *
 * @param date يوم بصيغة YYYY-MM-DD
 * @param locale لغة العرض
 * @returns التاريخ للعرض بالتقويم الميلادي وبأرقام لاتينية
 */
export function formatBusinessDate(date: string, locale: Locale): string {
  return formatDate(new Date(`${date}T12:00:00Z`), {
    locale,
    calendar: 'gregorian',
    timeZone: 'UTC',
  });
}

/**
 * تاريخ ولحظة بتوقيت النشاط؛ لو التوقيت مش معروف للمتصفح بتتعرض بـ UTC مكتوب جنبها.
 *
 * @param instant اللحظة
 * @param locale لغة العرض
 * @param timeZone اسم IANA لتوقيت النشاط
 * @returns التاريخ والوقت للعرض
 */
export function formatBusinessDateTime(
  instant: string,
  locale: Locale,
  timeZone: string,
): string {
  return businessFormatter(
    locale,
    timeZone,
    { dateStyle: 'long' },
    { year: 'numeric', month: 'long', day: 'numeric', ...TIME_FIELDS },
  ).format(new Date(instant));
}
