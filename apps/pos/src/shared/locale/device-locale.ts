import type { Locale } from '@pospay/i18n';

/**
 * لغة التليفون وقت أول تشغيل: عربي لو التليفون بالعربي، إنجليزي لأي لغة تانية (FR-015).
 *
 * الـ WKWebView بيعرف غير اللغات اللي التطبيق معرفها في Info.plist، فبدون
 * CFBundleLocalizations تليفون عربي بيفتح بالإنجليزي.
 *
 * @returns لغة التليفون
 */
export function deviceLocale(): Locale {
  return navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}
