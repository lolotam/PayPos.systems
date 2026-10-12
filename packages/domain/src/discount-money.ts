import { assertMoney, type Money } from './money.js';
import { roundKwd } from './rounding.js';

/**
 * يحسب صافي مبلغ غير سالب بعد خصم مالي؛ الخصم لا يتجاوز السعر ولا يمثل مرتجعاً.
 * التحقق من حدود numeric(14,3) يمنع قبول مدخل غير صالح حتى لو كان الفرق صالحاً.
 *
 * @param price السعر غير السالب بالفلس
 * @param discount الخصم غير السالب بالفلس، بحد أقصى السعر
 * @returns الصافي بالفلس ضمن المجال المالي
 * @throws {TypeError} إذا لم يكن أحد المبلغين bigint
 * @throws {RangeError} إذا خالف المبلغ المجال المالي أو قاعدة الخصم
 */
export function lineNet(price: Money, discount: Money): Money {
  assertMoney(price);
  assertMoney(discount);
  if (price < 0n || discount < 0n || discount > price) {
    throw new RangeError('Discount requires nonnegative money and cannot exceed price');
  }
  return price - discount;
}

/**
 * يحسب خصم نسبة صحيحة بوحدات أساس، ويقرب نصف الفلس لأعلى على مستوى البند.
 * النسبة من صفر إلى مئة بالمئة؛ لا يخفض الناتج ليلائم صلاحية شخص أو سياق طلب.
 *
 * @param price السعر غير السالب بالفلس
 * @param bps النسبة الصحيحة من 0 إلى 10000 بوحدات أساس
 * @returns الخصم بالفلس بعد التقريب لأقرب فلس
 * @throws {TypeError} إذا لم يكن السعر bigint
 * @throws {RangeError} إذا كان السعر أو النسبة خارج المجال المسموح
 */
export function discountFromPercent(price: Money, bps: number): Money {
  lineNet(price, 0n);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new RangeError('Discount bps must be an integer from 0 to 10000');
  }
  return roundKwd(price * BigInt(bps), 10000n);
}
