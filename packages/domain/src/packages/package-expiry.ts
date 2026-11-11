import { PackageRuleError } from './errors.js';

function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new PackageRuleError('INVALID_DATE');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new PackageRuleError('INVALID_DATE');
  }
}

/**
 * بيمنع الاستخدام والاسترداد بعد يوم الانتهاء، وبيسمح طول يوم الانتهاء نفسه (§8).
 * المستهلك بيبعت تاريخ الفرع المحلي؛ الدالة ما بتقراش الساعة ولا تختار timezone.
 *
 * @param today تاريخ اليوم في الفرع بصيغة YYYY-MM-DD
 * @param expiresOn تاريخ الانتهاء الحالي، بما فيه أي تمديد معتمد
 * @returns لا شيء؛ بعد الانتهاء بيترفض بخطأ PACKAGE_EXPIRED
 */
export function assertPackageNotExpired(today: string, expiresOn: string): void {
  validateDate(today);
  validateDate(expiresOn);
  if (today > expiresOn) throw new PackageRuleError('PACKAGE_EXPIRED');
}

/**
 * الصلاحية أيام تقويمية بعد يوم البيع المحلي، مش مضاعفات ٢٤ ساعة بتوقيت الفرع.
 *
 * @param soldBusinessDate يوم البيع المحلي بصيغة YYYY-MM-DD
 * @param validityDays مدة النوع المقروءة، من يوم إلى ٧٣٠ يوماً
 * @returns تاريخ الانتهاء؛ يوم الانتهاء نفسه يظل صالحاً للاستخدام
 */
export function packageExpiryDate(soldBusinessDate: string, validityDays: number): string {
  validateDate(soldBusinessDate);
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 730) {
    throw new PackageRuleError('INVALID_DATE');
  }
  const expiry = new Date(`${soldBusinessDate}T00:00:00.000Z`);
  expiry.setUTCDate(expiry.getUTCDate() + validityDays);
  const expiresOn = expiry.toISOString().slice(0, 10);
  validateDate(expiresOn);
  return expiresOn;
}
