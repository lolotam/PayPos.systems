import { computeCalcNumerator } from './commission-calc.ts';
import type { AmountTierStep, CommissionPricingLine } from './commission-types.ts';

function activeStep(steps: readonly AmountTierStep[], x: bigint): AmountTierStep | undefined {
  let active: AmountTierStep | undefined;
  for (const step of steps) {
    if (step.from > x) break;
    active = step;
  }
  return active;
}

/**
 * يحسب شرائح MARGINAL للمبلغ؛ لمس FIXED بطول موجب يثبت الشريحة السابقة للبند كله.
 * المجال نصف المفتوح يمنع حد نهاية البند من تحويله خطأً إلى مسار FIXED.
 *
 * @param line نصيب البند وحصته وعلامة المشاركة في الحد
 * @param steps حدود حرفية مرتبة تصاعدياً من خطة صحيحة
 * @param before مجمّع الموظفة قبل هذا البند
 * @returns بسط جزء الشرائح على مقام 10000، دون تقريب
 */
export function computeMarginalTierNumerator(
  line: CommissionPricingLine,
  steps: readonly AmountTierStep[],
  before: bigint,
): bigint {
  const previous = activeStep(steps, before);
  const whole = (): bigint =>
    previous === undefined ? 0n : computeCalcNumerator(previous.calc, line);
  if (!line.counts || line.netShare === 0n) return whole();
  const end = before + line.netShare;
  const boundaries = steps
    .filter((step) => step.from > before && step.from < end)
    .map((step) => step.from);
  let numerator = 0n;
  let start = before;
  for (const endpoint of [...boundaries, end]) {
    const length = endpoint - start;
    const step = activeStep(steps, start);
    if (step?.calc.kind === 'FIXED') return whole();
    if (step !== undefined)
      numerator += computeCalcNumerator(step.calc, { ...line, netShare: length });
    start = endpoint;
  }
  return numerator;
}
