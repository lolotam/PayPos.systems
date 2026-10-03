import { roundKwd } from '@pospay/domain';

import type { CommissionLineResult } from './commission-types.ts';
import type { CommissionPackageSale, CommissionPlan } from './plan-types.ts';

const calculators = {
  PCT: (value: bigint, remaining: bigint) => ({
    numerator: remaining * value,
    denominator: 10000n,
  }),
  FIXED: (value: bigint, remaining: bigint, paid: bigint) => ({
    numerator: remaining * value,
    denominator: paid,
  }),
};

/**
 * يحسب عمولة البائعة بعد المرتجع التناسبي؛ البيع لا يدخل مجمّع الخدمات وفق D-51.
 * وجود خطة معطلة يدفع صفراً، لكن غياب الخطة حتى للبيع المجاني يبقى NO_PLAN.
 *
 * @param sale سعر مدفوع ومرتجع صالح في 0…pricePaid؛ المستدعي اختار البائعة
 * @param plan إصدار مختار أو null عند غياب الإعداد
 * @returns عمولة بيع مقربة مرة واحدة أو خطأ NO_PLAN
 */
export function computePackageSaleCommission(
  sale: CommissionPackageSale,
  plan: CommissionPlan | null,
): CommissionLineResult {
  if (plan === null) return { ok: false, code: 'NO_PLAN' };
  const remaining = sale.pricePaid - sale.refundedAmount;
  if (!plan.packageSale.enabled || sale.pricePaid === 0n || remaining === 0n) {
    return { ok: true, amount: roundKwd(0n, 1n) };
  }
  const calc = plan.packageSale.calc;
  const exact = calculators[calc.kind](calc.value, remaining, sale.pricePaid);
  return { ok: true, amount: roundKwd(exact.numerator, exact.denominator) };
}
