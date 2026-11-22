import { moneyToString } from '@pospay/domain';

import { calcJson, microsToIso, ruleJson } from './canonical-format.ts';
import type { ServiceCommissionOverride } from './commission-types.ts';
import type {
  CommissionComponent,
  CommissionPlanVersion,
  CommissionThreshold,
  CommissionTiers,
} from './plan-types.ts';

/**
 * مكوّن الخطة: المعطّل بلا حساب، والمفعّل بحسابه.
 *
 * @param component مكوّن الخطة
 * @returns شكل JSON آمن
 */
function componentJson(component: CommissionComponent): object {
  return component.enabled ? { enabled: true, calc: calcJson(component.calc) } : { enabled: false };
}

/**
 * حد الشريحة: المبلغ بالـ KWD، والجلسات ومضاعف الراتب أعداد صحيحة نصية.
 *
 * @param threshold حد الشريحة
 * @returns شكل JSON آمن
 */
function thresholdJson(threshold: CommissionThreshold): { kind: string; value: string } {
  return {
    kind: threshold.kind,
    value:
      threshold.kind === 'AMOUNT' ? moneyToString(threshold.value) : threshold.value.toString(),
  };
}

/**
 * الشرائح بترتيب خطواتها زي ما اتخزنت؛ ترتيب الحدود جزء من معنى الخطة.
 *
 * @param tiers إعداد الشرائح
 * @returns شكل JSON آمن
 */
function tiersJson(tiers: CommissionTiers): object {
  if (!tiers.enabled) return { enabled: false };
  return {
    enabled: true,
    mode: tiers.mode,
    accumulator: tiers.accumulator,
    steps: tiers.steps.map((step) => ({
      from: thresholdJson(step.from),
      calc: calcJson(step.calc),
    })),
  };
}

/**
 * يكتب إصدار الخطة كاملاً كما يقرأه المحرك: هوية الإصدار، تاريخ سريانه، علامتا `whole_period`
 * و`repair_period`، وقت الإنشاء بدقة microsecond، والمكوّنات الثلاثة بحدودها.
 *
 * @param version إصدار الخطة بعد فكّ تشفيره
 * @returns شكل JSON آمن لـ canonicalJson: نصوص وأعداد صحيحة نصية فقط
 */
export function planVersionJson(version: CommissionPlanVersion): object {
  return {
    version: version.version.toString(),
    effective_from: version.effectiveFrom,
    whole_period: version.wholePeriod,
    repair_period: version.repairPeriod,
    created_at: microsToIso(version.createdAt),
    base: componentJson(version.base),
    tiers: tiersJson(version.tiers),
    package_sale: componentJson(version.packageSale),
  };
}

/**
 * يكتب تجاوز الخدمة كما يقرأه المحرك: هويته، الخدمة، تاريخ سريانه، وقت إنشائه (بيحسم التعادل)،
 * وقاعدته.
 *
 * @param override تجاوز الخدمة بعد فكّ تشفيره
 * @returns شكل JSON آمن لـ canonicalJson
 */
export function overrideJson(override: ServiceCommissionOverride): object {
  return {
    id: override.id,
    service_id: override.serviceId,
    effective_from: override.effectiveFrom,
    created_at: microsToIso(override.createdAt),
    rule: ruleJson(override.rule),
  };
}
