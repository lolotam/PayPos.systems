import type { CommissionCalc, CommissionPricingLine } from './commission-types.ts';

const calculators = {
  PCT: (value: bigint, line: CommissionPricingLine): bigint => line.netShare * value,
  FIXED: (value: bigint, line: CommissionPricingLine): bigint => line.shareBps * value,
};

/**
 * يحسب بسط عمولة دقيقة بمقام 10000؛ تأجيل التقريب يسمح بجمع الأساسي والشرائح مرة واحدة.
 *
 * @param calc النسبة بوحدات bps أو المبلغ الثابت بالفلس
 * @param line النصيب الفعلي للنسبة وحصة المؤدية للمبلغ الثابت
 * @returns بسط بالفلس على مقام 10000، بلا تقريب
 */
export function computeCalcNumerator(calc: CommissionCalc, line: CommissionPricingLine): bigint {
  return calculators[calc.kind](calc.value, line);
}
