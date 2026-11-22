/** خطة العمولة المخزّنة مشوهة؛ رفض فكّها يمنع تحويل إعداد مالي مجهول إلى تصحيح بقيمة صفرية. */
export class CommissionPlanDecodeError extends Error {
  readonly code = 'COMMISSION_PLAN_DECODE_INVALID';
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

/** شهر عمولة مغلق؛ الإسقاط عليه يُرفض حتى لا يتبدل كشف مالي مجمد. */
export class CommissionPeriodClosedError extends Error {
  readonly code = 'COMMISSION_PERIOD_CLOSED';
  readonly periods: readonly string[];

  /**
   * يحتفظ بالشهور المرفوضة حتى يعرف الحكم أي شهر أُغلق ومتى تم رفض الإسقاط.
   *
   * @param periods الشهور المغلقة التي رفضت الإسقاط عليها
   */
  constructor(periods: readonly string[]) {
    super(`Commission statement periods are closed: ${periods.join(', ')}`);
    this.name = 'CommissionPeriodClosedError';
    this.periods = [...periods];
  }
}

/** سبب رفض المُدخل؛ كلها أخطاء إدخال صريحة، وليس فيها إعادة محاولة تشغيلية. */
export type CommissionCorrectionTargetRefusal =
  | 'INVALID_SOURCE_PERIOD'
  | 'INVALID_CURRENT_PERIOD'
  | 'INVALID_CANDIDATE_PERIOD'
  | 'MISSING_STATEMENT_ID'
  | 'UNKNOWN_STATUS'
  | 'AMBIGUOUS_DUPLICATE_PERIOD';

/**
 * رفض مُدخل غير صالح؛ الاختيار يتوقف بدل أن يخمّن، لأن هدف غلط يغيّر شهر الرواتب
 * الذي يحمل التصحيح.
 */
export class CommissionCorrectionTargetInputError extends Error {
  readonly code = 'COMMISSION_CORRECTION_TARGET_INPUT_INVALID';
  readonly reason: CommissionCorrectionTargetRefusal;
  readonly period: string | null;

  /**
   * يحتفظ بسبب الرفض والشهر المعني حتى يصل صاحب التسليم إلى اللقطة أو القيمة المعطوبة.
   *
   * @param reason سبب الرفض الثابت الذي يصف نوع الخلل
   * @param period الشهر الذي وقع فيه الخلل، أو null إذا لم يكن الخلل مرتبطاً بشهر
   */
  constructor(reason: CommissionCorrectionTargetRefusal, period: string | null = null) {
    super(
      `Invalid commission correction target input: ${reason}${period === null ? '' : ` (${period})`}`,
    );
    this.name = 'CommissionCorrectionTargetInputError';
    this.reason = reason;
    this.period = period;
  }
}

/** سبب رفض مُدخل خطوة التصحيح؛ كلها أخطاء إدخال صريحة، وليس فيها إعادة محاولة تشغيلية. */
export type CommissionCorrectionStepRefusal =
  | 'DUPLICATE_SOURCE'
  | 'SOURCE_KIND_CONFLICT'
  | 'MISSING_ATTRIBUTION'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'FROZEN_SOURCE_ATTRIBUTION_MISSING';

/**
 * رفض مُدخل خطوة التصحيح؛ الحساب يتوقف بدل أن يبني صف تصحيح بمبلغ أو نسبة غلط،
 * لأن صفاً غلطاً في كشف رواتب لا يُصحَّح إلا بخطأ آخر. مرجع المصدر هو هوية
 * المصدر لوحده، فمرجع واحد بنوعين أو مبلغ برّه المدى رفضُ صريح مش مصدرين.
 */
export class CommissionCorrectionStepInputError extends Error {
  readonly code = 'COMMISSION_CORRECTION_STEP_INPUT_INVALID';
  readonly reason: CommissionCorrectionStepRefusal;
  readonly sourceRef: string | null;
  readonly kind: string | null;

  /**
   * يحتفظ بسبب الرفض والمصدر المعني حتى يصل صاحب التسليم إلى المدخل المعطوب.
   *
   * @param reason سبب الرفض الثابت الذي يصف نوع الخلل
   * @param sourceRef مرجع المصدر الذي وقع فيه الخلل، أو null إذا لم يكن الخلل مرتبطاً بمصدر
   * @param kind نوع المصدر الذي وقع فيه الخلل، أو null إذا لم يكن الخلل مرتبطاً بمصدر
   */
  constructor(
    reason: CommissionCorrectionStepRefusal,
    sourceRef: string | null = null,
    kind: string | null = null,
  ) {
    super(
      `Invalid commission correction step input: ${reason}${
        sourceRef === null ? '' : ` (${sourceRef}/${kind ?? ''})`
      }`,
    );
    this.name = 'CommissionCorrectionStepInputError';
    this.reason = reason;
    this.sourceRef = sourceRef;
    this.kind = kind;
  }
}

/** تسجيل توقف جديد محتاج جرساً لكن المنفذ ما اتمرّرش؛ الخطوة بترفض بدل ما تسجّل توقفاً بلا إشعار. */
export class CommissionBlockNoticesMissingError extends Error {
  readonly code = 'COMMISSION_BLOCK_NOTICES_MISSING';
  readonly blockId: string;

  /**
   * يحتفظ بهوية التوقف اللي كان محتاج جرساً حتى يصل صاحب الاستدعاء للمسار اللي نسي المنفذ.
   *
   * @param blockId هوية التوقف الذي لم يجد منفذ جرس
   */
  constructor(blockId: string) {
    super(`A new commission block needs a notice writer: ${blockId}`);
    this.name = 'CommissionBlockNoticesMissingError';
    this.blockId = blockId;
  }
}
