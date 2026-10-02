import { computeCalcNumerator } from './commission-calc.ts';
import type { AmountTierStep, CommissionPricingLine } from './commission-types.ts';
import { computeMarginalTierNumerator, findActiveTierStep } from './marginal-tiers.ts';
import type { ResolvedCommissionPlan } from './plan-types.ts';

function reachedNumerator(
  line: CommissionPricingLine,
  steps: readonly AmountTierStep[],
  x: bigint,
): bigint {
  const active = findActiveTierStep(steps, x);
  return active === undefined ? 0n : computeCalcNumerator(active.calc, line);
}

const evaluators = {
  AMOUNT: {
    MARGINAL: computeMarginalTierNumerator,
    WHOLE: reachedNumerator,
  },
  SESSIONS: {
    MARGINAL: reachedNumerator,
    WHOLE: reachedNumerator,
  },
};

/**
 * يحسب الجزء الدقيق للشرائح باستراتيجيات؛ الجلسات لا تنقسم وWHOLE يستخدم نهاية الفترة.
 * إعادة استخدام MARGINAL من engine I تمنع اختلاف قواعد لمس FIXED وحد نهاية البند.
 *
 * @param line نصيب البند وحصة المؤدية
 * @param tiers شرائح محلولة أو مكوّن معطل
 * @param before مجمّع النوع المختار قبل البند بوحداته الأصلية
 * @param final مجمّع النوع المختار في نهاية الفترة بوحداته الأصلية
 * @returns بسط على مقام 10000 مضروباً في مقياس الحدود دون تقريب
 */
export function computeTierNumerator(
  line: CommissionPricingLine,
  tiers: ResolvedCommissionPlan['tiers'],
  before: bigint,
  final: bigint,
): bigint {
  if (!tiers.enabled) return 0n;
  const scale = tiers.thresholdScale ?? 1n;
  const scaledLine = { ...line, netShare: line.netShare * scale };
  const scaledSteps = tiers.steps.map((step) => ({
    ...step,
    calc: { ...step.calc, value: step.calc.value * (step.calc.kind === 'FIXED' ? scale : 1n) },
  }));
  const x = (tiers.mode === 'WHOLE' ? final : before) * scale;
  return evaluators[tiers.accumulator][tiers.mode](scaledLine, scaledSteps, x);
}
