import { assertMoney } from '@pospay/domain';

/**
 * بيتحقق من حد الخصم الشخصي؛ الصفر منع صريح و10000 يعني 100% حسب نطاق PR 7b.
 *
 * @param bps الحد بوحدات 0.01%، بدون كسور
 * @returns القيمة نفسها بعد التحقق
 */
export function validateDiscountLimitBps(bps: number): number {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000)
    throw new RangeError('Invalid discount bps');
  return bps;
}

/**
 * بيحسب الخصم الفعلي لبند بالفلوس الصحيحة، بما فيه تخفيض السعر؛ الخدمة المجانية وزيادة السعر خصمهما صفر.
 * التقريب لأعلى إلى bps كاملة يمنع مرور خصم أعلى من سلطة الشخص بسبب التقريب لأسفل.
 *
 * @param listPrice سعر القائمة بالفلس كـ bigint، غير سالب
 * @param net الصافي بالفلس كـ bigint، غير سالب
 * @returns الخصم بوحدات 0.01%، مقرب لأعلى بدون أي وسيط عشري
 */
export function effectiveDiscountBps(listPrice: bigint, net: bigint): number {
  assertMoney(listPrice);
  assertMoney(net);
  if (listPrice < 0n || net < 0n) throw new RangeError('Discount line amounts must be nonnegative');
  if (listPrice === 0n || net >= listPrice) return 0;
  // قرار المالك 2026-10-03: التقريب لأعلى، فأي كسر فوق الحد يعتبر تجاوز ويحتاج موافقة؛ ADR-0005 يخص تقريب الفلوس بس.
  const numerator = (listPrice - net) * 10000n;
  return Number((numerator + listPrice - 1n) / listPrice);
}

/**
 * بيقارن الخصم بسلطة الشخص؛ المساواة مسموحة وما فوق الحد يحتاج اعتماد المدير في PR 38–41.
 *
 * @param effective الخصم الفعلي بوحدات 0.01%
 * @param limit الحد الشخصي أو حد النشاط بعد حل عدم الإعداد في PR 7c
 * @returns هل الخصم داخل الحد شاملًا المساواة
 */
export function isWithinLimit(effective: number, limit: number): boolean {
  return validateDiscountLimitBps(effective) <= validateDiscountLimitBps(limit);
}
