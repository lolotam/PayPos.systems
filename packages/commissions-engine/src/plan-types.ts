import type {
  AmountTierStep,
  CommissionCalc,
  CommissionLineOrder,
  CommissionPricingLine,
  CommissionRuleLine,
  ServiceCommissionOverride,
} from './commission-types.ts';
import type { CommissionConfigurationError } from './errors.ts';

/** قيمة الحد: فلس حرفي أو عدد جلسات أو أجزاء مئوية صحيحة لمضاعف الراتب k. */
export interface CommissionThreshold {
  readonly kind: 'AMOUNT' | 'SESSIONS' | 'SALARY_MULTIPLE';
  readonly value: bigint;
}

/** حدود من نوع واحد؛ اختلاف حساب كل شريحة مسموح وفق §5.7. */
export interface CommissionTierStep {
  readonly from: CommissionThreshold;
  readonly calc: CommissionCalc;
}

/** المكوّن المعطل لا يحتاج إعداد حساب؛ تشغيله يتطلب حساباً صالحاً. */
export type CommissionComponent =
  { readonly enabled: false } | { readonly enabled: true; readonly calc: CommissionCalc };

/** إعداد الشرائح قبل تحويل مضاعفات الراتب إلى حدود دقيقة. */
export type CommissionTiers =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly mode: 'MARGINAL' | 'WHOLE';
      readonly accumulator: 'AMOUNT' | 'SESSIONS';
      readonly steps: readonly CommissionTierStep[];
    };

/** الأساسي يجمع دائماً والشرائح تستبدل بعضها؛ بيع الباقة مستقل عن المجمّع. */
export interface CommissionPlan {
  readonly base: CommissionComponent;
  readonly tiers: CommissionTiers;
  readonly packageSale: CommissionComponent;
}

/** تاريخ النشاط يقرر الأهلية؛ وقت الإنشاء ثم رقم الإصدار يقرران الأولوية. */
export interface CommissionPlanVersion extends CommissionPlan {
  readonly employeeId: string;
  readonly effectiveFrom: string;
  readonly wholePeriod: boolean;
  readonly createdAt: bigint;
  readonly version: bigint;
}

/** خطوة محلولة بمقياس مشترك يحفظ أجزاء الفلس عند مضاعفات الراتب دون تقريب. */
export interface ResolvedCommissionPlan {
  readonly base: CommissionComponent;
  readonly tiers:
    | { readonly enabled: false }
    | {
        readonly enabled: true;
        readonly mode: 'MARGINAL' | 'WHOLE';
        readonly accumulator: 'AMOUNT' | 'SESSIONS';
        readonly steps: readonly AmountTierStep[];
        readonly thresholdScale?: bigint;
      };
}

/** سجل راتب متقارب مسبقاً؛ §4 يضمن صفاً واحداً لكل موظفة وتاريخ. */
export interface CommissionSalary {
  readonly employeeId: string;
  readonly effectiveFrom: string;
  readonly amount: bigint;
}

/** صف إسقاط نشط لمؤدية واحدة؛ netShare يشمل فلس الباقي المحسوم في engine I. */
export interface PeriodCommissionLine
  extends CommissionPricingLine, CommissionLineOrder, CommissionRuleLine {}

/** البيع للموظفة البائعة فقط؛ الباقة المستوردة ليس لها بائعة. */
export interface CommissionPackageSale {
  readonly saleId: string;
  readonly sellerEmployeeId: string | null;
  readonly businessDate: string;
  readonly pricePaid: bigint;
  readonly refundedAmount: bigint;
}

/** مدخلات فترة موظفة واحدة بتواريخ نشاط محسومة؛ لا يدخل المحرك في تحويل المنطقة الزمنية. */
export interface CommissionPeriodInput {
  readonly employeeId: string;
  readonly period: string;
  readonly periodLastDay: string;
  readonly lines: readonly PeriodCommissionLine[];
  readonly sales: readonly CommissionPackageSale[];
  readonly versions: readonly CommissionPlanVersion[];
  readonly overrides: readonly ServiceCommissionOverride[];
  readonly salaries: readonly CommissionSalary[];
}

/** كل مبلغ مصدر مقرب مرة واحدة؛ خطأ الإعداد يمنع نتيجة جزئية للفترة. */
export type CommissionPeriodResult =
  | { readonly ok: true; readonly perSource: Map<string, bigint>; readonly total: bigint }
  | { readonly ok: false; readonly code: CommissionConfigurationError };
