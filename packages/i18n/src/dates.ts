import type { Locale } from './catalog.js';

/** التقويم اللي النشاط بيعرض بيه التواريخ (إعدادات النشاط، T10-2). */
export type CalendarSystem = 'gregorian' | 'hijri';

const CALENDARS: Record<CalendarSystem, string> = {
  gregorian: 'gregory',
  // أم القرى: التقويم الهجري الرسمي في الخليج — بيتحسب، مش بيعتمد على رؤية الهلال.
  hijri: 'islamic-umalqura',
};

/**
 * هل الاسم ده time zone معروف (IANA) — قبل ما يتحفظ في فرع أو نشاط.
 *
 * @param name الاسم زي Asia/Kuwait
 * @returns true لو Intl عارفه
 */
export function isTimeZone(name: string): boolean {
  if (name === '') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * بيعرض تاريخ لحظة معينة زي ما الفرع شايفها: في الـ time zone بتاعه وبالتقويم اللي النشاط اختاره.
 * الأرقام لاتينية في اللغتين.
 *
 * @param instant  اللحظة (UTC)
 * @param options  اللغة والتقويم والـ time zone
 * @param options.locale   ar أو en
 * @param options.calendar gregorian أو hijri
 * @param options.timeZone الـ time zone الفعلي للفرع
 * @returns التاريخ للعرض، زي "13 ربيع الآخر 1448 هـ"
 */
export function formatDate(
  instant: Date,
  options: { locale: Locale; calendar: CalendarSystem; timeZone: string },
): string {
  return new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    calendar: CALENDARS[options.calendar],
    dateStyle: 'long',
    numberingSystem: 'latn',
  }).format(instant);
}

/**
 * يوم اللحظة دي في الـ time zone ده، كـ YYYY-MM-DD ميلادي — ده اليوم اللي الحضور والتقارير بتتجمع عليه، مش يوم UTC.
 *
 * @param instant  اللحظة (UTC)
 * @param timeZone الـ time zone الفعلي للفرع
 * @returns التاريخ المحلي، زي 2026-09-24
 */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'gregory',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    numberingSystem: 'latn',
  }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
