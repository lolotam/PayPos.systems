import { parseMoney } from '@pospay/domain';

import type {
  CommissionCalc,
  ServiceCommissionOverride,
  ServiceCommissionRule,
} from './commission-types.ts';
import type {
  CommissionComponent,
  CommissionPlanVersion,
  CommissionThreshold,
  CommissionTiers,
} from './plan-types.ts';
import { validateCommissionPlan } from './plan-validation.ts';
import { parseSalaryMultiple } from './salary-thresholds.ts';

/** صف إصدار خطة محفوظ كما يقرأه القارئ قبل ما يترجمه المحرك. */
export type StoredPlanVersionRow = {
  employeeId: string;
  version: number;
  effectiveFrom: string;
  wholePeriod: boolean;
  repairPeriod: string | null;
  plan: unknown;
  createdAt: string;
};

/** صف تجاوز خدمة محفوظ كما يقرأه القارئ قبل ما يترجمه المحرك. */
export type StoredOverrideRow = {
  id: string;
  employeeId: string;
  serviceId: string;
  effectiveFrom: string;
  ruleKind: string;
  rulePctBps: number | null;
  ruleFixedAmount: string | null;
  createdAt: string;
};

/** خطة محفوظة مشوهة؛ الفك بيتوقف بدل ما يتحوّل إلى خطة صفرية. */
export class CommissionPlanDecodeError extends Error {
  readonly fieldPath: string;

  /**
   * يحتفظ بمسار الحقل المعطوب فقط، لأن محتوى الخطة قد يكشف إعدادات مالية لا تدخل في رسالة الخطأ.
   *
   * @param fieldPath مسار الحقل الذي منع فكّ الخطة بأمان
   */
  constructor(fieldPath: string) {
    super(`Invalid commission plan at: ${fieldPath}`);
    this.name = 'CommissionPlanDecodeError';
    this.fieldPath = fieldPath;
  }
}

function invalid(fieldPath: string): never {
  throw new CommissionPlanDecodeError(fieldPath);
}

function objectOf(value: unknown, fieldPath: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(fieldPath);
  return value as Record<string, unknown>;
}

function bigintOf(value: string | number, fieldPath: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return invalid(fieldPath);
  }
}

function moneyOf(value: string, fieldPath: string): bigint {
  try {
    return parseMoney(value);
  } catch {
    return invalid(fieldPath);
  }
}

function salaryMultipleOf(value: string, fieldPath: string): bigint {
  try {
    const multiple = parseSalaryMultiple(value);
    return multiple.ok ? multiple.hundredths : invalid(fieldPath);
  } catch {
    return invalid(fieldPath);
  }
}

function decodeCalc(value: unknown, fieldPath: string): CommissionCalc {
  const calc = objectOf(value, fieldPath);
  if (calc.kind === 'PCT') {
    if (typeof calc.bps !== 'number' || !Number.isSafeInteger(calc.bps)) {
      invalid(`${fieldPath}.bps`);
    }
    return { kind: 'PCT', value: BigInt(calc.bps) };
  }
  if (calc.kind === 'FIXED') {
    if (typeof calc.amount !== 'string') invalid(`${fieldPath}.amount`);
    return { kind: 'FIXED', value: moneyOf(calc.amount, `${fieldPath}.amount`) };
  }
  return invalid(`${fieldPath}.kind`);
}

function decodeComponent(value: unknown, fieldPath: string): CommissionComponent {
  const component = objectOf(value, fieldPath);
  if (typeof component.enabled !== 'boolean') invalid(`${fieldPath}.enabled`);
  if (component.calc === undefined) {
    if (component.enabled) invalid(`${fieldPath}.calc`);
    return { enabled: false };
  }
  const calc = decodeCalc(component.calc, `${fieldPath}.calc`);
  return component.enabled ? { enabled: true, calc } : { enabled: false };
}

function decodeThreshold(value: unknown, fieldPath: string): CommissionThreshold {
  const threshold = objectOf(value, fieldPath);
  const kind = threshold.kind;
  if (kind !== 'AMOUNT' && kind !== 'SESSIONS' && kind !== 'SALARY_MULTIPLE') {
    invalid(`${fieldPath}.kind`);
  }
  if (typeof threshold.value !== 'string' && typeof threshold.value !== 'number') {
    invalid(`${fieldPath}.value`);
  }
  const storedValue = threshold.value;
  if (kind === 'SESSIONS') {
    return { kind, value: bigintOf(storedValue, `${fieldPath}.value`) };
  }
  if (kind === 'SALARY_MULTIPLE') {
    return { kind, value: salaryMultipleOf(String(storedValue), `${fieldPath}.value`) };
  }
  return { kind, value: moneyOf(String(storedValue), `${fieldPath}.value`) };
}

function decodeTiers(value: unknown, fieldPath: string): CommissionTiers {
  const tiers = objectOf(value, fieldPath);
  if (typeof tiers.enabled !== 'boolean') invalid(`${fieldPath}.enabled`);
  const configured =
    tiers.mode !== undefined || tiers.accumulator !== undefined || tiers.steps !== undefined;
  if (!tiers.enabled && !configured) return { enabled: false };
  const mode = tiers.mode;
  const accumulator = tiers.accumulator;
  if (mode !== 'MARGINAL' && mode !== 'WHOLE') invalid(`${fieldPath}.mode`);
  if (accumulator !== 'AMOUNT' && accumulator !== 'SESSIONS') {
    invalid(`${fieldPath}.accumulator`);
  }
  if (!Array.isArray(tiers.steps)) invalid(`${fieldPath}.steps`);
  const steps = tiers.steps.map((step, index) => {
    const storedStep = objectOf(step, `${fieldPath}.steps.${index}`);
    return {
      from: decodeThreshold(storedStep.from, `${fieldPath}.steps.${index}.from`),
      calc: decodeCalc(storedStep.calc, `${fieldPath}.steps.${index}.calc`),
    };
  });
  if (!tiers.enabled) return { enabled: false };
  return { enabled: true, mode, accumulator, steps };
}

/**
 * يحوّل قاعدة الخدمة المخزّنة في أعمدةها إلى الشكل اللي بيفهمه محرك العمولة.
 *
 * @param kind نوع القاعدة المخزّن
 * @param pctBps نسبة القاعدة بالنقاط الأساس
 * @param fixedAmount مبلغ القاعدة الثابت
 * @returns القاعدة في صيغة المحرك
 */
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

/**
 * الخطة المحفوظة jsonb بصيغة العقد (نِسَب بأرقام ومبالغ بنصوص)، والمحرك بيشتغل
 * بمبالغ bigint، فالترجمة بتعمل هنا عند الحد مرة واحدة وما بتتكررش في المجال.
 * أي حقل ناقص أو نوع مجهول يوقف القراءة بدل اختراع خطة صفرية، ثم يؤكد المحرك صلاحية التركيب.
 *
 * @param row صف إصدار الخطة المحفوظ
 * @returns إصدار الخطة في صيغة المحرك
 */
export function commissionPlanVersionOf(row: StoredPlanVersionRow): CommissionPlanVersion {
  const stored = objectOf(row.plan, 'plan');
  const plan = {
    base: decodeComponent(stored.base, 'base'),
    tiers: decodeTiers(stored.tiers, 'tiers'),
    packageSale: decodeComponent(stored.package_sale, 'package_sale'),
  };
  if (!validateCommissionPlan(plan).ok) invalid('plan');
  return {
    employeeId: row.employeeId,
    effectiveFrom: row.effectiveFrom,
    wholePeriod: row.wholePeriod,
    repairPeriod: row.repairPeriod,
    createdAt: BigInt(row.createdAt),
    version: BigInt(row.version),
    ...plan,
  };
}

/**
 * يحوّل صف التجاوز المحفوظ إلى صيغة المحرك.
 *
 * @param row صف التجاوز المحفوظ
 * @returns التجاوز في صيغة المحرك
 */
export function commissionOverrideOf(row: StoredOverrideRow): ServiceCommissionOverride {
  return {
    id: row.id,
    employeeId: row.employeeId,
    serviceId: row.serviceId,
    effectiveFrom: row.effectiveFrom,
    createdAt: BigInt(row.createdAt),
    rule: commissionRuleOf(row.ruleKind, row.rulePctBps, row.ruleFixedAmount),
  };
}
