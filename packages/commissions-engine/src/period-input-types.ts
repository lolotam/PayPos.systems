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

/** يجمع صفوف نشاط كامل ثم يضيقها إلى موظفة وشهر واحدين بقاعدة مشتركة. */
export interface CommissionPeriodProjection {
  readonly employeeId: string;
  readonly period: string;
  readonly lines: readonly ProjectedCommissionLine[];
  readonly sales: readonly ProjectedPackageSale[];
  readonly salaries: readonly CommissionSalary[];
  readonly versions: readonly CommissionPlanVersion[];
  readonly overrides: readonly ServiceCommissionOverride[];
  readonly tips: readonly ProjectedCommissionTip[];
  readonly corrections: readonly ReceivedCommissionCorrection[];
}

/** يفصل مدخل التسعير والراتب المختار عن القيم العرضية غير المسعرة. */
export interface AssembledCommissionPeriod {
  readonly input: CommissionPeriodInput;
  /** الراتب المختار هو وحده المؤثر في حدود الشهر، لا كل تاريخ الرواتب. */
  readonly salary: CommissionSalary | null;
  readonly tips: readonly ProjectedCommissionTip[];
  readonly corrections: readonly ReceivedCommissionCorrection[];
}
