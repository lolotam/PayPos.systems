import { assertMoney, type Money } from './money.js';

/**
 * بيقرّب مبلغ كسري بالفلوس (numerator / denominator) لأقرب فلس — half-up على مستوى البند.
 * النص بالظبط بيتقرّب بعيد عن الصفر في الاتجاهين (1.0005 ← 1.001 و -1.0005 ← -1.001)،
 * عشان المرتجع يبقى صورة طبق الأصل من البيع وصافيهم يطلع صفر بالظبط (ADR-0005).
 * الكسر بيتبعت كبسط ومقام عشان مفيش أي قيمة وسيطة تعدّي على number.
 *
 * @param numerator   البسط بالفلوس — ممكن يبقى سالب
 * @param denominator المقام — لازم يبقى موجب
 * @returns المبلغ متقرّب لأقرب فلس
 */
export function roundKwd(numerator: bigint, denominator: bigint): Money {
  if (denominator <= 0n) {
    throw new RangeError(`roundKwd denominator must be positive, got ${denominator}`);
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder * 2n < denominator) {
    return assertMoney(quotient);
  }
  return assertMoney(numerator < 0n ? quotient - 1n : quotient + 1n);
}
