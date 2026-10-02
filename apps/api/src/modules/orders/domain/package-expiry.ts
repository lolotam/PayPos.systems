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
