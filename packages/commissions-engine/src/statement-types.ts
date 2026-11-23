import type {
  CommissionEstimateAttachment,
  CommissionEstimateCorrection,
  CommissionEstimateLine,
  CommissionEstimateSale,
  CommissionEstimateTip,
} from './estimate-projection-types.ts';
import type { ServiceCommissionOverride } from './commission-types.ts';
import type { RevisedLine, RevisedSale, RevisedSalary, RevisedTip } from './canonical-input.ts';
import type { IncomingCommissionCarry } from './period-input-types.ts';
import type { CommissionPlanVersion } from './plan-types.ts';

/** أنواع صفوف الكشف المجمّد، نفس قيد `commission_statement_lines_kind` في قاعدة البيانات. */
export type StatementRowKind =
  | 'COMMISSION'
  | 'SALE'
  | 'TIP_CARD'
  | 'TIP_CASH'
  | 'CORRECTION'
  | 'CORRECTION_TIP_CARD'
  | 'CORRECTION_TIP_CASH'
  | 'CARRY_COMMISSION'
  | 'CARRY_TIP_CARD'
  | 'EMPLOYEE';

/**
 * أعمدة صف الكشف اللي بتتجمّد وبتدخل بصمة الكشف (D-6). من غير id وstatement_id وcompany_id
 * وbusiness_id وtimestamps لأنها ما بتكونش موجودة قبل التجميد. المبالغ نصوص KWD والتواريخ
 * YYYY-MM-DD، والغائب `null`.
 */
export interface StatementRow {
  readonly employeeId: string;
  readonly employeeNumber: number;
  readonly employeeNameAr: string | null;
  readonly employeeNameEn: string;
  readonly sourceRef: string;
  readonly kind: StatementRowKind;
  readonly amount: string;
  readonly previousAmount: string | null;
  readonly newAmount: string | null;
  readonly sourcePeriod: string | null;
  readonly sourceBranchId: string | null;
  readonly sourceBranchNameAr: string | null;
  readonly sourceBranchNameEn: string | null;
  readonly sourceBusinessDate: string | null;
  readonly attachedBranchIds: readonly string[];
  readonly lineId: string | null;
  readonly sessionId: string | null;
  readonly serviceId: string | null;
  readonly serviceNameAr: string | null;
  readonly serviceNameEn: string | null;
  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly businessDate: string | null;
}

/** ارتباط موظفة بفرع مقصوص على الشهر؛ النهاية آخر يوم داخل، زي ما بيتخزن في `commission_statement_attachments`. */
export interface StatementAttachmentRow {
  readonly employeeId: string;
  readonly branchId: string;
  readonly attachedFrom: string;
  readonly attachedTo: string;
}

/** بطاقة الموظفة وقت البناء: رقمها واسمها بالعربي والإنجليزي، مجمّدين مع كل صف (D-20). */
export interface StatementEmployeeLabel {
  readonly employeeId: string;
  readonly employeeNumber: number;
  readonly nameAr: string | null;
  readonly nameEn: string;
}

/** اسم بالعربي (اختياري) والإنجليزي. */
export interface StatementName {
  readonly nameAr: string | null;
  readonly nameEn: string;
}

/** الأسماء اللي بتتقرا بالمعرّف وقت البناء: الفروع والخدمات وأسماء العملاء الكاملة (D-20). */
export interface StatementNames {
  readonly branches: ReadonlyMap<string, StatementName>;
  readonly services: ReadonlyMap<string, StatementName>;
  readonly customers: ReadonlyMap<string, string>;
}

/** بند الشهر مع فرعه وجلسته وعميله؛ العميل `null` لما مفيش عميل مسجّل. */
export interface StatementLineSource extends CommissionEstimateLine, RevisedLine {
  readonly sessionId: string;
  readonly customerId: string | null;
}

/** بيع الباقة مع فرعه ونسخته. */
export interface StatementSaleSource extends CommissionEstimateSale, RevisedSale {}

/** بقشيش الشهر مع فرعه ونسخة جلسته. */
export interface StatementTipSource extends CommissionEstimateTip, RevisedTip {}

/** تصحيح مستلم مع معرّفه، وهو مرجع مصدر صفه المجمّد. */
export interface StatementCorrectionSource extends CommissionEstimateCorrection {
  readonly id: string;
}

/**
 * صفوف النشاط في الشهر اللي بيبني منها الكشف. التصحيحات الموقوفة المفتوحة مش هنا: الباني ما بيقراهاش،
 * ومراجعة الكشف واعتماده بيفحصوها بنفسهم (FR-027، FR-048)، وهي بتدخل بصمة المدخلات بس.
 */
export interface StatementMonthRows {
  readonly lines: readonly StatementLineSource[];
  readonly sales: readonly StatementSaleSource[];
  readonly tips: readonly StatementTipSource[];
  readonly salaries: readonly RevisedSalary[];
  readonly versions: readonly CommissionPlanVersion[];
  readonly overrides: readonly ServiceCommissionOverride[];
  readonly corrections: readonly StatementCorrectionSource[];
  readonly carries: readonly IncomingCommissionCarry[];
}

/** تفاصيل البند من رأس إسقاطه: الجلسة والخدمة والعميل ويوم العمل، وبتتجمّد مع صف تصحيحه. */
export interface StatementLineHead {
  readonly sessionId: string;
  readonly serviceId: string;
  readonly customerId: string | null;
  readonly businessDate: string;
}

/** مدخل بناء الكشف: الموظفات داخل النطاق ببطاقاتهن، وارتباطاتهن الحيّة، والأسماء. */
export interface StatementBuildInput {
  readonly period: string;
  readonly month: StatementMonthRows;
  /** الموظفات داخل النطاق، كل واحدة بتاخد صف EMPLOYEE؛ ولازم تشمل كل موظفة ليها أي صف. */
  readonly employees: readonly StatementEmployeeLabel[];
  /** كل ارتباط للموظفات داخل النطاق بيتقاطع مع الشهر، بنصف مفتوح `[from, to)`. */
  readonly attachments: readonly CommissionEstimateAttachment[];
  readonly names: StatementNames;
  /**
   * رأس إسقاط كل بند مصدر لتصحيح، بمعرّف البند (FR-033، D-20). بند ما بقاش له رأس مش موجود هنا،
   * وصف تصحيحه بيطلع من غير تفاصيل البند بدل ما نخترعها.
   */
  readonly correctionLineDetails: ReadonlyMap<string, StatementLineHead>;
}

/** فشل تسعير موظفة: كود المحرك، وبيمنع المراجعة والاعتماد (FR-027). */
export interface StatementPricingFailure {
  readonly employeeId: string;
  readonly code: 'NO_PLAN' | 'NO_SALARY';
}

/** ناتج الباني: الصفوف اللي هتتجمّد، ومرفقاتها، وفشل التسعير لكل موظفة. */
export interface StatementBuild {
  readonly rows: readonly StatementRow[];
  readonly attachments: readonly StatementAttachmentRow[];
  readonly failures: readonly StatementPricingFailure[];
}
