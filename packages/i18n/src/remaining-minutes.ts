import { t, type Locale } from './catalog.js';

/** يعرض المدة المتبقية بالدقائق باللغة المختارة، مستقلة عن المنطقة الزمنية.
 * @param expiresAt نهاية الجلسة المطلقة
 * @param now ساعة العرض
 * @param locale لغة الواجهة
 * @returns وصف محلي للمدة المتبقية
 */
export function formatRemainingMinutes(expiresAt: Date, now: Date, locale: Locale): string {
  const minutes = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000));
  const number = new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).format(minutes);
  return t(locale, 'staffLogin.expiresIn').replace('{minutes}', number);
}
