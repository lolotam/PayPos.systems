import {
  parseSalaryMultiple,
  type CommissionCalc,
  type CommissionComponent,
  type CommissionPlanVersion,
  type CommissionThreshold,
  type CommissionTiers,
  type ServiceCommissionOverride,
  type ServiceCommissionRule,
} from '@pospay/commissions-engine';
import { parseMoney } from '@pospay/domain';

export type PlanVersionRow = {
  employeeId: string;
  version: number;
  effectiveFrom: string;
  wholePeriod: boolean;
  plan: unknown;
  createdAt: string;
};

export type OverrideRow = {
  id: string;
  employeeId: string;
  serviceId: string;
  effectiveFrom: string;
  ruleKind: string;
  rulePctBps: number | null;
  ruleFixedAmount: string | null;
  createdAt: string;
};

/** يحوّل قاعدة الخدمة المخزّنة في أعمدةها إلى الشكل اللي بيفهمه محرك العمولة. */
export function commissionRuleOf(
  kind: string,
  pctBps: number | null,
  fixedAmount: string | null,
): ServiceCommissionRule {
  if (kind === 'PCT') return { kind: 'PCT', value: BigInt(pctBps ?? 0) };
  if (kind === 'FIXED') return { kind: 'FIXED', value: parseMoney(fixedAmount ?? '0.000') };
  if (kind === 'ZERO') return { kind: 'ZERO' };
  return { kind: 'FOLLOW_PLAN' };
}

function decodeCalc(value: unknown): CommissionCalc | undefined {
  if (value === null || value === undefined) return undefined;
  const calc = value as { kind?: string; bps?: number; amount?: string };
  if (calc.kind === 'FIXED') return { kind: 'FIXED', value: parseMoney(calc.amount ?? '0.000') };
  return { kind: 'PCT', value: BigInt(calc.bps ?? 0) };
}

function decodeComponent(value: unknown): CommissionComponent {
  const component = (value ?? {}) as { enabled?: boolean; calc?: unknown };
  if (component.enabled !== true) return { enabled: false };
  return { enabled: true, calc: decodeCalc(component.calc) ?? { kind: 'PCT', value: 0n } };
}

function decodeThreshold(value: unknown): CommissionThreshold {
  const threshold = (value ?? {}) as { kind?: string; value?: string | number };
  if (threshold.kind === 'SESSIONS') {
    return { kind: 'SESSIONS', value: BigInt(threshold.value ?? 0) };
  }
  if (threshold.kind === 'SALARY_MULTIPLE') {
    const multiple = parseSalaryMultiple(String(threshold.value ?? '0'));
    return { kind: 'SALARY_MULTIPLE', value: multiple.ok ? multiple.hundredths : 0n };
  }
  return { kind: 'AMOUNT', value: parseMoney(String(threshold.value ?? '0.000')) };
}

function decodeTiers(value: unknown): CommissionTiers {
  const tiers = (value ?? {}) as {
    enabled?: boolean;
    mode?: 'MARGINAL' | 'WHOLE';
    accumulator?: 'AMOUNT' | 'SESSIONS';
    steps?: readonly { from?: unknown; calc?: unknown }[];
  };
  if (tiers.enabled !== true) return { enabled: false };
  return {
    enabled: true,
    mode: tiers.mode ?? 'MARGINAL',
    accumulator: tiers.accumulator ?? 'AMOUNT',
    steps: (tiers.steps ?? []).map((step) => ({
      from: decodeThreshold(step.from),
      calc: decodeCalc(step.calc) ?? { kind: 'PCT', value: 0n },
    })),
  };
}

/**
 * الخطة المحفوظة jsonb بصيغة العقد (نِسَب بأرقام ومبالغ بنصوص)، والمحرك بيشتغل
 * بمبالغ bigint، فالترجمة بتعمل هنا عند الحد مرة واحدة وما بتتكررش في المجال.
 */
export function commissionPlanVersionOf(row: PlanVersionRow): CommissionPlanVersion {
  const stored = (row.plan ?? {}) as {
    base?: unknown;
    tiers?: unknown;
    package_sale?: unknown;
  };
  return {
    employeeId: row.employeeId,
    effectiveFrom: row.effectiveFrom,
    wholePeriod: row.wholePeriod,
    createdAt: BigInt(row.createdAt),
    version: BigInt(row.version),
    base: decodeComponent(stored.base),
    tiers: decodeTiers(stored.tiers),
    packageSale: decodeComponent(stored.package_sale),
  };
}

export function commissionOverrideOf(row: OverrideRow): ServiceCommissionOverride {
  return {
    id: row.id,
    employeeId: row.employeeId,
    serviceId: row.serviceId,
    effectiveFrom: row.effectiveFrom,
    createdAt: BigInt(row.createdAt),
    rule: commissionRuleOf(row.ruleKind, row.rulePctBps, row.ruleFixedAmount),
  };
}
