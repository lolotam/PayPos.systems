import type { ServiceCommissionOverride } from './commission-types.ts';
import type {
  CommissionPackageSale,
  CommissionPeriodInput,
  CommissionPlanVersion,
  CommissionSalary,
  PeriodCommissionLine,
} from './plan-types.ts';

/** حالة الإسقاط محفوظة على الصف حتى لا يدخل بند ملغى في حساب المال. */
export type CommissionProjectionStatus = 'ACTIVE' | 'CANCELLED';

/** يضيف حالة الإسقاط إلى لقطة البند دون تغيير المدخل الذي يفهمه المحرك. */
export interface ProjectedCommissionLine extends PeriodCommissionLine {
  readonly status: CommissionProjectionStatus;
}

/** يميز البيع الملغى قبل التجميع، مع إبقاء بيانات التسعير الأصلية كما هي. */
export interface ProjectedPackageSale extends CommissionPackageSale {
  readonly status: CommissionProjectionStatus;
}

/** تبقى الإكرامية خارج مدخل المحرك حتى لا تؤثر في الحدود أو العمولة. */
export interface ProjectedCommissionTip {
  readonly sessionId: string;
  readonly employeeId: string;
  readonly businessDate: string;
  readonly method: 'CARD' | 'CASH';
  readonly amount: bigint;
}

/** يحمل فرق شهر مغلق إلى شهر مستلم دون أن يعيد تسعير مصدره. */
export interface ReceivedCommissionCorrection {
  readonly employeeId: string;
  readonly sourcePeriod: string;
  readonly targetPeriod: string;
  readonly sourceRef: string;
  readonly kind: 'COMMISSION' | 'SALE' | 'TIP_CARD' | 'TIP_CASH';
  readonly amount: bigint;
  readonly previousAmount: bigint;
  readonly newAmount: bigint;
  readonly generation: bigint;
}

/** يحفظ حقول المستدعي مثل revision وbranchId للبصمة والفلترة بدلاً من ضياعها عند التجميع. */
export interface CommissionPeriodProjection<
  L extends ProjectedCommissionLine = ProjectedCommissionLine,
  S extends ProjectedPackageSale = ProjectedPackageSale,
  Sal extends CommissionSalary = CommissionSalary,
  T extends ProjectedCommissionTip = ProjectedCommissionTip,
  C extends ReceivedCommissionCorrection = ReceivedCommissionCorrection,
> {
  readonly employeeId: string;
  readonly period: string;
  readonly lines: readonly L[];
  readonly sales: readonly S[];
  readonly salaries: readonly Sal[];
  readonly versions: readonly CommissionPlanVersion[];
  readonly overrides: readonly ServiceCommissionOverride[];
  readonly tips: readonly T[];
  readonly corrections: readonly C[];
}

/** يبقي حقول الصفوف للبصمة وفلتر الفروع بينما يقرأ المحرك مدخل التسعير وحده. */
export interface AssembledCommissionPeriod<
  L extends ProjectedCommissionLine = ProjectedCommissionLine,
  S extends ProjectedPackageSale = ProjectedPackageSale,
  Sal extends CommissionSalary = CommissionSalary,
  T extends ProjectedCommissionTip = ProjectedCommissionTip,
  C extends ReceivedCommissionCorrection = ReceivedCommissionCorrection,
> {
  readonly input: CommissionPeriodInput;
  readonly lines: readonly L[];
  readonly sales: readonly S[];
  /** الراتب المختار يحتفظ بنوع سجل المستدعي لأن بصمته تحتاج بياناته الإضافية. */
  readonly salary: Sal | null;
  readonly tips: readonly T[];
  readonly corrections: readonly C[];
}
