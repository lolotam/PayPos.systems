import type { ServiceCommissionOverride } from './commission-types.ts';
import type {
  IncomingCommissionCarry,
  ProjectedCommissionLine,
  ProjectedCommissionTip,
  ProjectedPackageSale,
  ReceivedCommissionCorrection,
} from './period-input-types.ts';
import type { CommissionPlanVersion, CommissionSalary } from './plan-types.ts';

/**
 * نطاق القارئ على مستوى النشاط (CS-Q20): النشاط كله أو فروع محددة. `businessWide`
 * يعني إن القارئ شايف كل موظفة النشاط وكل صف من صفوفهن.
 */
export interface CommissionEstimateScope {
  readonly businessWide: boolean;
  readonly branchIds: readonly string[];
}

/** ارتباط موظفة بفرع بتاريخين: البداية داخلة والنهاية خارجة، والفارغة ارتباط مفتوح. */
export interface CommissionEstimateAttachment {
  readonly employeeId: string;
  readonly branchId: string;
  readonly from: string;
  readonly to: string | null;
}

/** بند خدمة في شهر الموظفة مع فرعه؛ تاريخ العمل هو مفتاح الفلترة باليوم. */
export interface CommissionEstimateLine extends ProjectedCommissionLine {
  readonly branchId: string;
}

/** بيع باقة في شهر الموظفة مع فرعه؛ الحالة المحفوظة بتتحوّل لحالة المحرك. */
export interface CommissionEstimateSale extends ProjectedPackageSale {
  readonly branchId: string;
}

/** بقشيش الشهر مع فرعه ويومه؛ البقشيش بيعدّي من غير تسعير (D-1). */
export interface CommissionEstimateTip extends ProjectedCommissionTip {
  readonly branchId: string;
}

/** تصحيح مستلم في الشهر: نسبته المجمَّدة وفروعه المجمَّدة بتحددوا رؤيته (FR-040). */
export interface CommissionEstimateCorrection extends ReceivedCommissionCorrection {
  readonly sourceBranchId: string;
  readonly sourceBusinessDate: string;
  readonly attachedBranchIds: readonly string[];
}

/** صفوف الشهر كلها مقروءة مرة واحدة: البنود والبيع والبقشيش والرواتب والإصدارات والتجاوزات والتصحيحات. */
export interface CommissionEstimateMonthRows {
  readonly lines: readonly CommissionEstimateLine[];
  readonly sales: readonly CommissionEstimateSale[];
  readonly tips: readonly CommissionEstimateTip[];
  readonly salaries: readonly CommissionSalary[];
  readonly versions: readonly CommissionPlanVersion[];
  readonly overrides: readonly ServiceCommissionOverride[];
  readonly corrections: readonly CommissionEstimateCorrection[];
  /** المرحّلات اللي كشفها الهدف هو الشهر ده (D-22)؛ بتعدّي من غير تسعير. */
  readonly carries?: readonly IncomingCommissionCarry[];
}

/** مدخلات الإسقاط: النطاق والشهر والموظفات ذات الصفوف وأسماء القارئ. */
export interface CommissionEstimateProjectionInput {
  readonly scope: CommissionEstimateScope;
  readonly period: string;
  /** الموظفات اللاتي عندهن صف في قارئ الأسماء؛ مين مش فيهم ما بتتعرضش. */
  readonly employeeIds: readonly string[];
  readonly month: CommissionEstimateMonthRows;
  readonly attachments: readonly CommissionEstimateAttachment[];
}

/** حالة تسعير شهر الموظفة: OK أو سبب منع التسعير (D-57). */
export type CommissionEstimateStatus = 'OK' | 'NO_PLAN' | 'NO_SALARY';

/** مصدر مسعَّر: البند أو بيع الباقة، بمبلغه وفرع عمله ويومه. */
export interface CommissionEstimateSourceProjection {
  readonly sourceRef: string;
  readonly kind: 'COMMISSION' | 'SALE';
  readonly amount: bigint;
  readonly branchId: string;
  readonly businessDate: string;
  readonly serviceId: string | null;
}

/** بيع الباقة المسعَّر. */
export interface CommissionEstimateSaleProjection {
  readonly saleId: string;
  readonly amount: bigint;
  readonly branchId: string;
  readonly businessDate: string;
}

/** تصحيح مستلم في الشهر، بيعرض بمبلغه المجمد. */
export interface CommissionEstimateCorrectionProjection {
  readonly sourceRef: string;
  readonly kind: 'COMMISSION' | 'SALE' | 'TIP_CARD' | 'TIP_CASH';
  readonly amount: bigint;
  readonly sourceBranchId: string;
  readonly sourceBusinessDate: string;
}

/** تقدير موظفة واحدة: مصادرها المسعّرة وبقشيشها وتصحيحاتها ومجموعها وحالتها. */
export interface CommissionEstimateEmployeeProjection {
  readonly employeeId: string;
  readonly status: CommissionEstimateStatus;
  /** أرقامها جزئية: صف من شهرها خارج نطاق القارئ أو تغطية ناقصة لأيام الشهر. */
  readonly partial: boolean;
  /** null لما ما تسعّرش شهرها؛ المبلغ المجهول ما يتصدقش إنه صفر (FR-021). */
  readonly total: bigint | null;
  readonly sources: readonly CommissionEstimateSourceProjection[];
  readonly sales: readonly CommissionEstimateSaleProjection[];
  readonly tips: { readonly card: bigint; readonly cash: bigint };
  readonly corrections: readonly CommissionEstimateCorrectionProjection[];
  /**
   * المرحّل الداخل لموظفة في الشهر (D-22، BR-06): رصيد العمولة ورصيد بقشيش الكارت منفصلين
   * ولا بيتقاصّوا. مرئي للقارئ على مستوى النشاط بس، لأن المرحّل مالوش فرع.
   */
  readonly carries: { readonly commission: bigint; readonly tipCard: bigint };
}

/** تقدير النشاط لشهر واحد: الموظفات المرئيات ومجموعهن المرئي. */
export interface CommissionEstimateProjection {
  readonly employees: readonly CommissionEstimateEmployeeProjection[];
  /** المجموع جزئي للقارئ على مستوى الفروع؛ القارئ على مستوى النشاط بيشوف الكل. */
  readonly partial: boolean;
  readonly total: bigint | null;
}
