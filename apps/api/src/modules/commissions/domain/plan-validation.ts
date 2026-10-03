import type { CommissionValidationError, CommissionValidationResult } from './errors.ts';

type RecordValue = Record<string, unknown>;

const combinations: Readonly<Record<string, readonly string[]>> = {
  AMOUNT: ['AMOUNT', 'SALARY_MULTIPLE'],
  SESSIONS: ['SESSIONS'],
};
const modes = new Set(['MARGINAL', 'WHOLE']);
const thresholdChecks: Readonly<Record<string, (value: bigint) => boolean>> = {
  AMOUNT: (value) => value >= 0n,
  SESSIONS: (value) => value >= 0n,
  SALARY_MULTIPLE: (value) => value > 0n,
};
const calcChecks: Readonly<Record<string, (value: bigint) => boolean>> = {
  PCT: (value) => value >= 0n && value <= 10000n,
  FIXED: (value) => value >= 0n,
};

function record(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function validCalc(value: unknown): boolean {
  const calc = record(value);
  return (
    calc !== null &&
    typeof calc.kind === 'string' &&
    typeof calc.value === 'bigint' &&
    Object.hasOwn(calcChecks, calc.kind) &&
    (calcChecks[calc.kind]?.(calc.value) ?? false)
  );
}

function componentError(value: unknown): CommissionValidationError | null {
  const component = record(value);
  if (component === null || typeof component.enabled !== 'boolean') return 'INVALID_PLAN';
  if (component.enabled || component.calc !== undefined) {
    if (!validCalc(component.calc)) return 'INVALID_CALC';
  }
  return null;
}

function stepsError(tiers: RecordValue): CommissionValidationError | null {
  if (!Array.isArray(tiers.steps)) return 'INVALID_PLAN';
  if (tiers.enabled && tiers.steps.length === 0) return 'NO_STEPS';
  let kind: string | undefined;
  let previous: bigint | undefined;
  for (const value of tiers.steps) {
    const step = record(value);
    const from = record(step?.from);
    if (
      from === null ||
      typeof from.kind !== 'string' ||
      typeof from.value !== 'bigint' ||
      !Object.hasOwn(thresholdChecks, from.kind) ||
      !thresholdChecks[from.kind]?.(from.value)
    )
      return 'INVALID_THRESHOLD';
    if (kind !== undefined && from.kind !== kind) return 'MIXED_THRESHOLDS';
    if (!combinations[String(tiers.accumulator)]?.includes(from.kind)) return 'INVALID_COMBINATION';
    if (previous !== undefined && from.value <= previous) return 'STEPS_NOT_ASCENDING';
    if (!validCalc(step?.calc)) return 'INVALID_CALC';
    kind = from.kind;
    previous = from.value;
  }
  return null;
}

function tiersError(value: unknown): CommissionValidationError | null {
  const tiers = record(value);
  if (tiers === null || typeof tiers.enabled !== 'boolean') return 'INVALID_PLAN';
  if (
    !tiers.enabled &&
    tiers.mode === undefined &&
    tiers.accumulator === undefined &&
    tiers.steps === undefined
  )
    return null;
  if (
    typeof tiers.mode !== 'string' ||
    !modes.has(tiers.mode) ||
    typeof tiers.accumulator !== 'string' ||
    !Object.hasOwn(combinations, tiers.accumulator)
  ) {
    return 'INVALID_COMBINATION';
  }
  return stepsError(tiers);
}

/**
 * يتحقق من جدول §5.7 كبيانات؛ نفس الدالة تصلح لمنشئ الخطط والـ API بلا سلاسل شروط لكل تركيب.
 * نوع الحد واحد لكل خطة والشرائح تصاعدية؛ المكوّن المعطل يسمح بحذف إعداده.
 *
 * @param value خطة داخلية بقيم bigint؛ unknown يسمح برفض مدخلات غير ممثلة في الأنواع
 * @returns نجاح أو كود مسمى يحدد الإعداد أو التركيب غير الصالح
 */
export function validateCommissionPlan(value: unknown): CommissionValidationResult {
  const plan = record(value);
  if (plan === null) return { ok: false, code: 'INVALID_PLAN' };
  const code =
    componentError(plan.base) ?? tiersError(plan.tiers) ?? componentError(plan.packageSale);
  return code === null ? { ok: true } : { ok: false, code };
}
