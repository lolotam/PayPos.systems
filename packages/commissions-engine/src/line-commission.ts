import { roundKwd } from '@pospay/domain';

import { computeCalcNumerator } from './commission-calc.ts';
import type {
  CommissionLineResult,
  CommissionPricingLine,
  ServiceCommissionRule,
} from './commission-types.ts';
import type { ResolvedCommissionPlan } from './plan-types.ts';
import { computeTierNumerator } from './tier-evaluators.ts';

/**
 * يحسب عمولة FOLLOW_PLAN من الأساسي والشرائح الدقيقة ثم تقريب واحد وفق ADR-0005.
 * اختيار إصدار الخطة محسوم خارج هذه الدالة، والمجمّع لا يتبع عمر الإصدار.
 *
 * @param line النصيب والحصة وعلامة المشاركة في الحد
 * @param plan خطة مختارة بحدود محلولة دقيقة دون تقريب
 * @param before مجمّع النوع المختار قبل هذا البند
 * @param final المجمّع النهائي لتسعير WHOLE؛ الافتراضي يحافظ على مستدعي engine I
 * @returns عمولة البند بالفلس بعد تقريب واحد بعيداً عن الصفر عند النصف
 */
export function computeFollowPlanLine(
  line: CommissionPricingLine,
  plan: ResolvedCommissionPlan,
  before: bigint,
  final: bigint = before,
): bigint {
  const scale = plan.tiers.enabled ? (plan.tiers.thresholdScale ?? 1n) : 1n;
  const base = plan.base.enabled ? computeCalcNumerator(plan.base.calc, line) * scale : 0n;
  const tiers = computeTierNumerator(line, plan.tiers, before, final);
  return roundKwd(base + tiers, 10000n * scale);
}

/**
 * يسعر البند بالقاعدة المختارة؛ التجاوز يستبدل الخطة، وغياب خطة FOLLOW_PLAN خطأ لا صفر.
 * كل مسار ناجح ينتهي بتقريب واحد للبند، حتى ZERO، لتوحيد التعامل مع نصف الفلس.
 *
 * @param line النصيب الفعلي وحصة المؤدية وعلامة المشاركة
 * @param rule قاعدة محسومة بالتجاوز أو لقطة الخدمة
 * @param plan خطة مختارة مسبقاً أو null إن لم توجد؛ مطلوبة فقط مع FOLLOW_PLAN
 * @param before مجمّع النوع المختار قبل البند، لا يتم تعديله هنا
 * @param final المجمّع النهائي للفترة عند WHOLE
 * @returns العمولة بالفلس أو NO_PLAN؛ لا يُقرب المجمّع أو أجزاء العمولة منفردة
 */
export function computeLineCommission(
  line: CommissionPricingLine,
  rule: ServiceCommissionRule,
  plan: ResolvedCommissionPlan | null,
  before: bigint,
  final: bigint = before,
): CommissionLineResult {
  if (rule.kind === 'FOLLOW_PLAN') {
    return plan === null
      ? { ok: false, code: 'NO_PLAN' }
      : { ok: true, amount: computeFollowPlanLine(line, plan, before, final) };
  }
  const numerator = rule.kind === 'ZERO' ? 0n : computeCalcNumerator(rule, line);
  return { ok: true, amount: roundKwd(numerator, 10000n) };
}
