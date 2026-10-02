import { roundKwd } from '@pospay/domain';

import { computeCalcNumerator } from './commission-calc.ts';
import type {
  CommissionLineResult,
  CommissionPricingLine,
  MarginalAmountPlan,
  ServiceCommissionRule,
} from './commission-types.ts';
import { computeMarginalTierNumerator } from './marginal-tiers.ts';

/**
 * يحسب عمولة FOLLOW_PLAN من الأساسي والشرائح الدقيقة ثم تقريب واحد وفق ADR-0005.
 * اختيار إصدار الخطة محسوم خارج هذه الدالة في PR 30، والمجمّع لا يتبع عمر الإصدار.
 *
 * @param line النصيب والحصة وعلامة المشاركة في الحد
 * @param plan خطة MARGINAL للمبلغ مختارة مسبقاً بحدود حرفية
 * @param before مجمّع الفترة قبل هذا البند
 * @returns عمولة البند بالفلس بعد تقريب واحد بعيداً عن الصفر عند النصف
 */
export function computeFollowPlanLine(
  line: CommissionPricingLine,
  plan: MarginalAmountPlan,
  before: bigint,
): bigint {
  const base = plan.base.enabled ? computeCalcNumerator(plan.base.calc, line) : 0n;
  const tiers = plan.tiers.enabled
    ? computeMarginalTierNumerator(line, plan.tiers.steps, before)
    : 0n;
  return roundKwd(base + tiers, 10000n);
}

/**
 * يسعر البند بالقاعدة المختارة؛ التجاوز يستبدل الخطة، وغياب خطة FOLLOW_PLAN خطأ لا صفر.
 * كل مسار ناجح ينتهي بتقريب واحد للبند، حتى ZERO، لتوحيد التعامل مع نصف الفلس.
 *
 * @param line النصيب الفعلي وحصة المؤدية وعلامة المشاركة
 * @param rule قاعدة محسومة بالتجاوز أو لقطة الخدمة
 * @param plan خطة مختارة مسبقاً أو null إن لم توجد؛ مطلوبة فقط مع FOLLOW_PLAN
 * @param before مجمّع المبلغ قبل البند، لا يتم تعديله هنا
 * @returns العمولة بالفلس أو NO_PLAN؛ لا يُقرب المجمّع أو أجزاء العمولة منفردة
 */
export function computeLineCommission(
  line: CommissionPricingLine,
  rule: ServiceCommissionRule,
  plan: MarginalAmountPlan | null,
  before: bigint,
): CommissionLineResult {
  if (rule.kind === 'FOLLOW_PLAN') {
    return plan === null
      ? { ok: false, code: 'NO_PLAN' }
      : { ok: true, amount: computeFollowPlanLine(line, plan, before) };
  }
  const numerator = rule.kind === 'ZERO' ? 0n : computeCalcNumerator(rule, line);
  return { ok: true, amount: roundKwd(numerator, 10000n) };
}
