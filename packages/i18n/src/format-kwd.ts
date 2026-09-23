import { moneyToString, type Money } from '@pospay/domain';

/**
 * بيعرض مبلغ بالدينار الكويتي بـ 3 خانات عشرية وفاصل آلاف: 12500n ← "12.500"، و1234567n ← "1,234.567".
 * بيبني على moneyToString من packages/domain عشان الرقم اللي بيتعرض هو نفس اللي بيتخزن، ومفيش float في النص.
 *
 * @param value المبلغ بالفلوس (1 دينار = 1000 فلس)
 * @returns المبلغ للعرض، بأرقام لاتينية ومن غير رمز العملة
 */
export function formatKwd(value: Money): string {
  const [whole = '', fraction = ''] = moneyToString(value).split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign === '' ? whole : whole.slice(1);
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
