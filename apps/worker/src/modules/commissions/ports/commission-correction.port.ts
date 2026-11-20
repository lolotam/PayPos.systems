import type {
  CommissionPeriodProjection,
  CommissionSalary,
  ProjectedCommissionLine,
  ProjectedCommissionTip,
  ProjectedPackageSale,
} from '@pospay/commissions-engine';

import type { CommissionAttachmentInterval } from '../domain/commission-correction-attribution.ts';
import type {
  CommissionCorrectionDraft,
  CommissionFrozenSource,
  CommissionPostedCorrection,
} from '../domain/commission-correction-step.ts';
import type {
  CommissionBlockCode,
  CommissionOpenBlock,
} from '../domain/commission-blocked-correction.ts';

/** بند الشهر مع فرعه وتاريخ عمله، حتى لا تفقد إعادة الحساب أصل نسبة التصحيح. */
export type CommissionMonthLine = ProjectedCommissionLine & {
  readonly branchId: string;
  readonly businessDate: string;
};

/** بقشيش الشهر مع فرعه وتاريخ عمله كما وصلا من الإسقاط المصدر. */
export type CommissionMonthTip = ProjectedCommissionTip & {
  readonly branchId: string;
  readonly businessDate: string;
};

/** إسقاط الشهر الذي يحفظ بيانات أصل المصادر بجانب مدخلات تسعير المحرك. */
export type CommissionMonthProjection = CommissionPeriodProjection<
  CommissionMonthLine,
  ProjectedPackageSale,
  CommissionSalary,
  CommissionMonthTip
>;

/** مُدخلات قراءة المصادر المجمّدة لموظفة في كشف شهر المصدر. */
export interface CommissionFrozenSourcesInput {
  readonly businessId: string;
  readonly statementId: string;
  readonly employeeId: string;
}

/** مُدخلات قراءة التصحيحات المنشورة لموظفة في شهر مصدر واحد. */
export interface CommissionPostedCorrectionsInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly sourcePeriod: string;
}

/** مُدخلات قراءة لقطة ارتباطات الموظفة المجمّدة في كشف شهر المصدر. */
export interface CommissionAttachmentSnapshotInput {
  readonly businessId: string;
  readonly statementId: string;
  readonly employeeId: string;
}

/** مُدخلات قراءة إسقاط موظفة في شهر واحد بأشكال محرك العمولة. */
export interface CommissionMonthProjectionInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly period: string;
}

/** مُدخلات رفع جيل تصحيحات موظفة في شهر واحد. */
export interface CommissionGenerationInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly period: string;
}

/** مُدخلات كتابة صفوف التصحيح: النشاط والمسودات المحسوبة جواها. */
export interface CommissionCorrectionInsertInput {
  readonly businessId: string;
  readonly drafts: readonly CommissionCorrectionDraft[];
}

/** مُدخلات قراءة التوقوف المفتوح لموظفة في شهر مصدر واحد. */
export interface CommissionOpenBlockInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly sourcePeriod: string;
}

/** مُدخلات تسجيل توقوف جديد: الرمز والحدث الأول والشهر المحتجز وكشفه المرسوم مرة واحدة. */
export interface CommissionBlockInsertInput {
  readonly businessId: string;
  readonly employeeId: string;
  readonly sourcePeriod: string;
  readonly code: CommissionBlockCode;
  readonly firstEventId: string;
  readonly targetPeriod: string;
  readonly targetStatementId: string;
}

/** مُدخلات تبديل رمز التوقوف المفتوح؛ الشهر المحتجز والحدث الأول لا يتبدلان. */
export interface CommissionBlockCodeUpdateInput {
  readonly businessId: string;
  readonly blockId: string;
  readonly code: CommissionBlockCode;
}

/** مُدخلات حلّ التوقوف المفتوح بلحظة الحل وجيل الخطوة التي نجحت ونشرت. */
export interface CommissionBlockResolutionInput {
  readonly businessId: string;
  readonly blockId: string;
  readonly generation: number;
}

/**
 * نطاق التصحيح: يقرأ مصادر شهر مغلق، يعيد حسابه بالمدخلات الحالية، ويكتب صفوف التصحيح.
 * كل دالة بتشتغل في معاملة الحدث نفسها اللي ماسكة أقفال الشهور، فما ينفع تفتح معاملة تانية.
 */
export interface CommissionCorrectionScope {
  /**
   * يرجع المصادر المجمّدة لموظفة في كشف شهر المصدر مع نسبتها المنسوخة، وهي
   * مرجع المقارنة بين ما اتجمّد من قبل وما اتحسب تاني.
   *
   * @param input النشاط وكشف الشهر والموظفة
   */
  readFrozenSources(
    input: CommissionFrozenSourcesInput,
  ): Promise<readonly CommissionFrozenSource[]>;
  /**
   * يرجع التصحيحات المنشورة لنفس شهر المصدر لنفس الموظفة، لأن مجموعها هو اللي
   * اتحمّل على المصدر قبل الجيل الجديد.
   *
   * @param input النشاط والموظفة وشهر المصدر
   */
  readPostedCorrections(
    input: CommissionPostedCorrectionsInput,
  ): Promise<readonly CommissionPostedCorrection[]>;
  /**
   * يرجع لقطة ارتباطات الموظفة المجمّدة في كشف شهر المصدر، وهي المصدر الوحيد
   * لنسبة مصدر ما اتجمّدش قبل كده (FR-040).
   *
   * @param input النشاط وكشف الشهر والموظفة
   */
  readAttachmentSnapshot(
    input: CommissionAttachmentSnapshotInput,
  ): Promise<readonly CommissionAttachmentInterval[]>;
  /**
   * يرجع إسقاط الشهر بالمدخلات الحالية لأن إعادة الحساب تحتاج أشكال محرك العمولة نفسها.
   *
   * @param input النشاط والموظفة والشهر المطلوب إسقاطه
   */
  readMonthProjection(input: CommissionMonthProjectionInput): Promise<CommissionMonthProjection>;
  /**
   * يرفع جيل تصحيحات الموظفة في الشهر: جيل واحد لو الصف غايب، وجيل زائد لو
   * موجود، ويرجع الرقم الجديد.
   *
   * @param input النشاط والموظفة والشهر
   */
  bumpGeneration(input: CommissionGenerationInput): Promise<number>;
  /**
   * يكتب صفوف التصحيح المحسوبة، وهي صفوف تُضاف بس وما بتتعدّلش بعد كده (FR-040).
   *
   * @param input النشاط والمسودات المحسوبة
   */
  insertCorrections(input: CommissionCorrectionInsertInput): Promise<void>;
  /**
   * يرجع التوقوف المفتوح للموظفة في الشهر، اللي الخطوة بتعيد استعماله بدل صف جديد (FR-046).
   *
   * @param input النشاط والموظفة وشهر المصدر
   */
  readOpenBlock(input: CommissionOpenBlockInput): Promise<CommissionOpenBlock | null>;
  /**
   * بيسجّل التوقوف برمزه والشهر المحتجز وكشفه المرسوم مرة واحدة، ويرجع هويته (FR-046).
   *
   * @param input الرمز والحدث الأول والشهر المحتجز وكشفه
   */
  insertBlock(input: CommissionBlockInsertInput): Promise<string>;
  /**
   * بيبدّل رمز التوقوف المفتوح بس، لأن الشهر المحتجز والحدث الأول ممنوع يتبدلوا (CM-52b).
   *
   * @param input هوية الصف والرمز الجديد
   */
  updateBlockCode(input: CommissionBlockCodeUpdateInput): Promise<void>;
  /**
   * بيحلّ التوقوف المفتوح بلحظة الحل وجيل الخطوة اللي نجحت ونشرت (FR-047).
   *
   * @param input هوية الصف وجيل الخطوة الحالّة
   */
  resolveBlock(input: CommissionBlockResolutionInput): Promise<void>;
}
