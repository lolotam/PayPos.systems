import type { Locale } from '@pospay/i18n';

import { parseLocale } from './parse-locale';

const LOCALE_KEY = 'pospay.locale';

export function readStoredLocale(): Locale {
  try {
    return parseLocale(localStorage.getItem(LOCALE_KEY));
  } catch {
    return 'ar';
  }
}

export function writeStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    return;
  }
}
