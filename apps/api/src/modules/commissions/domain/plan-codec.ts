import { parseMoney } from '@pospay/domain';

interface WireCalc {
  readonly kind: 'PCT' | 'FIXED';
  readonly bps?: number;
  readonly amount?: string;
}

interface WireComponent {
  readonly enabled: boolean;
  readonly calc?: WireCalc | undefined;
}

interface WireThreshold {
  readonly kind: 'AMOUNT' | 'SESSIONS' | 'SALARY_MULTIPLE';
  readonly value: string | number;
}

interface WireStep {
  readonly from: WireThreshold;
  readonly calc: WireCalc;
}

interface WireTiers {
  readonly enabled: boolean;
  readonly mode?: 'MARGINAL' | 'WHOLE' | undefined;
  readonly accumulator?: 'AMOUNT' | 'SESSIONS' | undefined;
  readonly steps?: readonly WireStep[] | undefined;
}

/** شكل الخطة كما يصل من العقد قبل ترجمته إلى الصيغة التي يفهمها المحرك، وهو حد الفصل بين ما يُحفظ وما يُحسب. */
export interface CommissionPlanWire {
  readonly base: WireComponent;
  readonly tiers: WireTiers;
  readonly package_sale: WireComponent;
}

function calc(value: WireCalc | undefined) {
  if (value === undefined) return undefined;
  return value.kind === 'PCT'
    ? { kind: value.kind, value: BigInt(value.bps ?? 0) }
    : { kind: value.kind, value: parseMoney(value.amount ?? '0.000') };
}

function component(value: WireComponent) {
  return { enabled: value.enabled, calc: calc(value.calc) };
}

function salaryHundredths(value: string): bigint {
  const [integer = '0', fraction = ''] = value.split('.');
  return BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function threshold(value: WireThreshold) {
  return {
    kind: value.kind,
    value:
      value.kind === 'AMOUNT'
        ? parseMoney(String(value.value))
        : value.kind === 'SALARY_MULTIPLE'
          ? salaryHundredths(String(value.value))
          : BigInt(value.value),
  };
}

/**
 * يحول شكل خطة العقد إلى الشكل الداخلي الذي يفهمه محرك العمولة، مع إبقاء المال bigint والحدود
 * بلا تحويل عبر number. هذه ترجمة تمثيل فقط؛ القبول الدلالي مسؤولية validateCommissionPlan.
 *
 * @param plan مكونات الخطة وشرائحها بصيغة العقد snake_case
 * @returns خطة بقيم bigint وبالاسم packageSale الذي يتوقعه المحرك
 */
export function toEngineCommissionPlan(plan: CommissionPlanWire): unknown {
  return {
    base: component(plan.base),
    tiers: {
      ...plan.tiers,
      steps: plan.tiers.steps?.map((step) => ({
        from: threshold(step.from),
        calc: calc(step.calc),
      })),
    },
    packageSale: component(plan.package_sale),
  };
}
