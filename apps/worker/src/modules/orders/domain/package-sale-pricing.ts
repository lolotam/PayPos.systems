import { effectiveDiscountBps, validatePackagePrice, type Money } from '@pospay/domain';

import { PackageSalePricingError } from './package-sale-errors.ts';

/** مدخل تسعير بيع الباقة: سعر النوع والمبلغ المدفوع وحدّ المسجّلة بعد حلّه. */
export interface PackageSalePricingInput {
  /** سعر النوع من القائمة بالفلس؛ الصفر مسموح للباقة المجانية. */
  readonly typePrice: Money;
  /** المبلغ المدفوع بالفلس؛ يجوز أن يزيد سعر النوع زي بند الزيارة (SS-Q4). */
  readonly pricePaid: Money;
  /** حدّ المسجّلة بالوحدات الأساسية بعد حلّه، و null يعني بلا حدّ (المالك). */
  readonly limitBps: number | null;
}

/** ناتج تسعير بيع الباقة: مبلغ الخصم ونسبته بالوحدات الأساسية. */
export interface PackageSalePricingResult {
  /** مبلغ الخصم بالفلس؛ صفر إذا المدفوع بلغ سعر النوع أو تجاوزه. */
  readonly discount: Money;
  /** نسبة الخصم بالوحدات الأساسية؛ صفر عند سعر نوع صفر. */
  readonly discountBps: number;
}

/**
 * يفحص شكل حدّ المسجّلة بنفس قواعد حدود الوحدات الأساسية المستعملة في باقي المشروع.
 * null يعني بلا حدّ، وكل عدد تاني لازم يكون صحيحاً بين صفر وعشرة آلاف؛
 * وما فيش تسامح مع قيمة مش صحيحة، عشان ما نحسبش نسبة على أساس غلط.
 *
 * @param limitBps الحدّ المحلول أو null يعني بلا حدّ
 * @returns الحدّ بعد الفحص كما هو
 * @throws {PackageSalePricingError} إذا كان الحدّ خارج الشكل المقبول
 */
function assertSaleLimitBps(limitBps: number | null): number | null {
  if (limitBps === null) return null;
  if (!Number.isInteger(limitBps) || limitBps < 0 || limitBps > 10000) {
    throw new PackageSalePricingError('INVALID_LIMIT');
  }
  return limitBps;
}

/**
 * يحسب خصم بيع الباقة ونسبته على سعر النوع، ويفحصها على حدّ المسجّلة المحلول.
 * القاعدة: الخصم = الفرق بين سعر النوع والمبلغ المدفوع إذا كان المدفوع أقل، وإلا صفر،
 * والنسبة = ceil(الخصم × 10000 ÷ سعر النوع) وصفر عند سعر نوع صفر (FR-012).
 * الخصم فوق حدّ المسجّلة بيترفض بالرمز المسمّى ومن غير أي كتابة (FR-013).
 *
 * @param input سعر النوع والمبلغ المدفوع وحدّ المسجّلة المحلول
 * @returns مبلغ الخصم ونسبته بالوحدات الأساسية
 * @throws {PackageRuleError} إذا كان أحد المبلغين سالباً أو خارج حدود numeric(14,3)
 * @throws {PackageSalePricingError} إذا تجاوز الخصم حدّ المسجّلة أو الحدّ نفسه مش صالح
 */
export function computePackageSalePricing(
  input: PackageSalePricingInput,
): PackageSalePricingResult {
  const typePrice = validatePackagePrice(input.typePrice);
  const pricePaid = validatePackagePrice(input.pricePaid);
  const limitBps = assertSaleLimitBps(input.limitBps);
  const discountBps = effectiveDiscountBps(typePrice, pricePaid);
  const discount = typePrice > pricePaid ? typePrice - pricePaid : 0n;
  if (limitBps !== null && discountBps > limitBps) {
    throw new PackageSalePricingError('PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT', {
      limitBps,
      discountBps,
    });
  }
  return { discount, discountBps };
}
