import { CommissionPeriodInvalidError } from './errors.ts';

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * يقول إن التاريخ تاريخ تقويمي حقيقي: سنة من 0001 إلى 9999 وشهر ويوم موجودين في التقويم.
 * السنة 0000 مرفوضة لأن PostgreSQL ما بيعرف يحوّلها، واليوم بيتم بصيغة UTC عشان
 * سنة كبيسة ما تتفسّرش على يوم تاني.
 *
 * @param value التاريخ النصي المطلوب فحصه
 * @returns true فقط لتاريخ تقويمي حقيقي بصيغة YYYY-MM-DD
 */
export function isCommissionCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  if (year === 0) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * يقول إن الشهر بصيغة YYYY-MM بسنة من 0001 إلى 9999 وشهر من 01 إلى 12؛ سنة 0000 مرفوضة
 * لأن جداول العمولة ما بتحوّلش ولا شهر بيقدّر.
 *
 * @param period القيمة النصية المطلوبة
 * @returns true فقط لشهر صالح
 */
export function isCommissionPeriod(period: string): boolean {
  return PERIOD.test(period) && !period.startsWith('0000-');
}

/**
 * رقم الشهر المتسلسل من سنة وشهر، عشان الفرق بين شهرين يتحسب من غير حلقة.
 *
 * @param period الشهر بصيغة YYYY-MM
 * @returns رقم الشهر المتسلسل
 */
export function commissionMonthIndex(period: string): number {
  return Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7));
}

/**
 * يوحّد الشهر على الصورة YYYY-MM: نفس الشهر أو تاليه بعده. شهر غلط بيرمي بدل ما
 * يكمّل الحلقة لحد ما تخلص، فالمدى ما بيتقفلش على الأبد.
 *
 * @param period الشهر الحالي
 * @returns الشهر التالي
 * @throws CommissionPeriodInvalidError عند شهر مش صالح
 */
export function nextCommissionPeriod(period: string): string {
  if (!isCommissionPeriod(period)) throw new CommissionPeriodInvalidError(period);
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}
