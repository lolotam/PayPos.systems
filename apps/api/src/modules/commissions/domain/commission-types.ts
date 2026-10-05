// قاعدة الخدمة اتنقلت للـ shared kernel عشان catalog (تخزينها) وcommissions (تسعيرها) يستخدموا نفس النوع
// من غير نسخة تانية ولا import بين domain موديولين؛ إعادة التصدير دي بتحافظ على مسارات PR 29 كما هي.
import type { CommissionCalc, ServiceCommissionRule } from '@pospay/domain';

export type { CommissionCalc, ServiceCommissionRule } from '@pospay/domain';

/** نصيب الموظفة بعد توزيع فلس الباقي؛ counts يحدد دخول قيمة البند في المجمّع. */
export interface CommissionPricingLine {
  readonly netShare: bigint;
  readonly shareBps: bigint;
  readonly counts: boolean;
}

/** حصة مؤدية واحدة؛ صحة القائمة ومجموع 10000 من مسؤولية شريحة تسجيل البند. */
export interface LinePerformerShare {
  readonly employeeId: string;
  readonly shareBps: bigint;
}

/** أوقات UTC بوحدات microseconds لحفظ دقة ترتيب البنود المتأخرة كما هي في قاعدة البيانات. */
export interface CommissionLineOrder {
  readonly lineId: string;
  readonly occurredAt: bigint;
  readonly recordedAt: bigint;
}

/** تاريخ النشاط محسوم مسبقاً بصيغة YYYY-MM-DD؛ لا يستنتج المحرك المنطقة الزمنية. */
export interface CommissionRuleLine {
  readonly employeeId: string;
  readonly serviceId: string;
  readonly businessDate: string;
  readonly ruleSnapshot: ServiceCommissionRule;
}

/** اختيار التجاوز حسب تاريخ النشاط ثم createdAt بوحدات UTC microseconds وبعده id. */
export interface ServiceCommissionOverride {
  readonly id: string;
  readonly employeeId: string;
  readonly serviceId: string;
  readonly effectiveFrom: string;
  readonly createdAt: bigint;
  readonly rule: ServiceCommissionRule;
}

/** حد حرفي بالفلس؛ ترتيب الحدود وصحتها يأتيان من التحقق المؤجل إلى PR 30. */
export interface AmountTierStep {
  readonly from: bigint;
  readonly calc: CommissionCalc;
}

/** الخطة مختارة بالفعل؛ اختيار الإصدارات وباقي أنماط الشرائح يضافان في PR 30. */
export interface MarginalAmountPlan {
  readonly base:
    { readonly enabled: false } | { readonly enabled: true; readonly calc: CommissionCalc };
  readonly tiers:
    | { readonly enabled: false }
    | {
        readonly enabled: true;
        readonly mode: 'MARGINAL';
        readonly accumulator: 'AMOUNT';
        readonly steps: readonly AmountTierStep[];
      };
}

/** غياب الخطة المطلوبة خطأ مسمّى، حتى لو كان صافي البند صفراً. */
export type CommissionLineResult =
  { readonly ok: true; readonly amount: bigint } | { readonly ok: false; readonly code: 'NO_PLAN' };
