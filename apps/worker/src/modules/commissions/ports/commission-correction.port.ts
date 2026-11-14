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
}
