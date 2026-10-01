import type { Locale } from '@pospay/i18n';

export function parseLocale(value: string | null | undefined): Locale {
  return value === 'en' ? 'en' : 'ar';
}
