import type { Locale } from '@pospay/i18n';

export const LOCALE_COOKIE = 'pospay_locale';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function writeLocaleCookie(locale: Locale): void {
  const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax${secure}`;
}
