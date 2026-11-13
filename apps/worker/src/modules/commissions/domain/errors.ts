/** حدث بند غير صالح؛ إيقافه يمنع كتابة لقطة مال أو أنصبة مشوهة ويُبقي الحدث لإصلاح منتجه. */
export class CommissionLineEventInvalidError extends Error {
  readonly code = 'COMMISSION_LINE_EVENT_INVALID';
  readonly reason: string;
  readonly lineId: string | null;

  /**
   * يحتفظ بسبب الرفض وهوية البند حتى يصلح المنتج الحدث المعطوب بدل فقدانه.
   *
   * @param reason سبب الرفض الثابت الذي يسهّل تشخيص الحدث
   * @param lineId هوية البند عند معرفتها، أو null لخطأ في الغلاف كله
   */
  constructor(reason: string, lineId: string | null = null) {
    super(`Invalid commission line event: ${reason}${lineId === null ? '' : ` (${lineId})`}`);
    this.name = 'CommissionLineEventInvalidError';
    this.reason = reason;
    this.lineId = lineId;
  }
}

/** النشاط غير موجود عند قراءة منطقته الزمنية؛ إيقاف الإسقاط يمنع إنشاء شهور لنشاط مجهول. */
export class CommissionBusinessMissingError extends Error {
  readonly code = 'COMMISSION_BUSINESS_MISSING';
  readonly businessId: string;

  /**
   * يحتفظ بهوية النشاط المطلوب حتى يظهر سبب إيقاف الإسقاط بوضوح.
   *
   * @param businessId هوية النشاط الذي لم ترجع له قراءة tenancy صفاً
   */
  constructor(businessId: string) {
    super(`Commission business is missing: ${businessId}`);
    this.name = 'CommissionBusinessMissingError';
    this.businessId = businessId;
  }
}

/** الموظفة غير موجودة لحدث راتب قديم بلا نشاط؛ إيقاف الإسقاط يمنع نسب الراتب لنشاط مجهول. */
export class CommissionEmployeeBusinessMissingError extends Error {
  readonly code = 'COMMISSION_EMPLOYEE_BUSINESS_MISSING';
  readonly employeeId: string;

  /**
   * يحتفظ بهوية الموظفة التي تعذّرت قراءة نشاطها حتى يظهر سبب إيقاف الإسقاط بوضوح.
   *
   * @param employeeId هوية الموظفة التي لم يرجع لها قارئ staff نشاطاً
   */
  constructor(employeeId: string) {
    super(`Commission employee business is missing: ${employeeId}`);
    this.name = 'CommissionEmployeeBusinessMissingError';
    this.employeeId = employeeId;
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

/** مدخل بقشاش أو راتب غير صالح؛ المبلغ المشوّه يوقف الحدث عند منتجه (FR-017) ولا يصير صفراً. */
export class CommissionTipSalaryInputInvalidError extends Error {
  readonly code = 'COMMISSION_TIP_SALARY_INPUT_INVALID';
  readonly reason: string;

  /**
   * يحتفظ بسبب الرفض حتى يصلح المنتج الحدث بدل ضياعه.
   *
   * @param reason سبب الرفض الثابت
   */
  constructor(reason: string) {
    super(`Invalid commission tip or salary input: ${reason}`);
    this.name = 'CommissionTipSalaryInputInvalidError';
    this.reason = reason;
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
