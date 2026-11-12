import { PackageRuleError } from './errors.js';
import { validateDate } from './package-expiry.js';

function leapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * بيحسب أقصى تاريخ مسموح لتمديد الباقة: سنتين تقويميتين من يوم الفرع المحلي.
 * لو اليوم 29 فبراير والسنة الهدف مش كبيسة، الحد بيبقى 28 فبراير بدل لف التاريخ لمارس.
 *
 * @param today تاريخ اليوم المحلي للفرع بصيغة YYYY-MM-DD
 * @returns تاريخ الحد الأقصى بصيغة YYYY-MM-DD
 */
export function packageExtensionLimit(today: string): string {
  validateDate(today);
  const year = Number(today.slice(0, 4));
  const month = today.slice(5, 7);
  const day = Number(today.slice(8, 10));
  const targetYear = year + 2;
  const targetDay = month === '02' && day === 29 && !leapYear(targetYear) ? 28 : day;
  const limit = `${String(targetYear).padStart(4, '0')}-${month}-${String(targetDay).padStart(2, '0')}`;
  validateDate(limit);
  return limit;
}

/**
 * بيفرض أن التمديد للأمام فقط وأن تاريخه الجديد لا يتجاوز سنتين من يوم الفرع.
 * الباقة المنتهية قابلة للتمديد؛ لا توجد مقارنة بتاريخ اليوم غير حد السنتين.
 *
 * @param today تاريخ اليوم المحلي للفرع بصيغة YYYY-MM-DD
 * @param currentExpiresOn تاريخ الانتهاء المقروء من الاستحقاق المقفول
 * @param newExpiresOn تاريخ الانتهاء الجديد المطلوب
 * @returns لا شيء؛ الرفض يكون PACKAGE_EXTENSION_NOT_LATER أو PACKAGE_EXTENSION_TOO_LONG
 */
export function assertPackageExtensionAllowed(
  today: string,
  currentExpiresOn: string,
  newExpiresOn: string,
): void {
  validateDate(today);
  validateDate(currentExpiresOn);
  validateDate(newExpiresOn);
  if (newExpiresOn <= currentExpiresOn) {
    throw new PackageRuleError('PACKAGE_EXTENSION_NOT_LATER');
  }
  if (newExpiresOn > packageExtensionLimit(today)) {
    throw new PackageRuleError('PACKAGE_EXTENSION_TOO_LONG');
  }
}
