import type { Locale } from '@pospay/i18n';

import { parseLocale } from './parse-locale';

const LOCALE_KEY = 'pospay.locale';

/**
 * بيقرأ اللغة المحفوظة على الجهاز.
 *
 * @param fallback اللغة اللي تبدأ بيها لما مفيش لغة محفوظة صالحة
 * @returns اللغة المحفوظة، أو اللغة الاحتياطية
 */
export function readStoredLocale(fallback: Locale = 'ar'): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === null) return fallback;
    // parseLocale بيرجع 'ar' لأي قيمة مش معروفة، فالمقارنة بتعرف إن المحفوظ مش صالح.
    const parsed = parseLocale(stored);
    return parsed === stored ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    return;
  }
}
