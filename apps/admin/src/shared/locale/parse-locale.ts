import type { Locale } from '@pospay/i18n';

export function parseLocale(value: string | undefined): Locale {
  return value === 'en' ? 'en' : 'ar';
}
