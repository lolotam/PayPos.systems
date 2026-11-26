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

/** الشهر الحالي تغيّر أثناء انتظار قفل الشهور؛ التراجع وإعادة المحاولة يمنعان اختيار هدف من لقطة ناقصة. */
export class CommissionPeriodRolledOverError extends Error {
  readonly code = 'COMMISSION_PERIOD_ROLLED_OVER';
  readonly plannedPeriod: string;
  readonly currentPeriod: string;

  /**
   * يحتفظ بشهر خطة القفل والشهر الحالي بعد الانتظار حتى يعيد التسليم الحساب بخطة كاملة.
   *
   * @param plannedPeriod الشهر الحالي الذي بُنيت عليه خطة القفل
   * @param currentPeriod الشهر الحالي بعد اكتمال القفل
   */
  constructor(plannedPeriod: string, currentPeriod: string) {
    super(`Commission current period rolled over: ${plannedPeriod} -> ${currentPeriod}`);
    this.name = 'CommissionPeriodRolledOverError';
    this.plannedPeriod = plannedPeriod;
    this.currentPeriod = currentPeriod;
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

/** مدخل بيع باقة غير صالح؛ الغلاف المخالف أو المبلغ المشوّه يوقف الحدث عند منتجه ولا يُسقَط غلط. */
export class CommissionSaleInputInvalidError extends Error {
  readonly code = 'COMMISSION_SALE_INPUT_INVALID';
  readonly reason: string;

  /**
   * يحتفظ بسبب الرفض حتى يصلح المنتج الحدث بدل ضياعه.
   *
   * @param reason سبب الرفض الثابت
   */
  constructor(reason: string) {
    super(`Invalid commission sale input: ${reason}`);
    this.name = 'CommissionSaleInputInvalidError';
    this.reason = reason;
  }
}

/**
 * حجم مجموعة جرس التوقف غير صالح؛ القسمة بحجم مش عدد صحيح موجب بتلف لامتناهي
 * أو بتقطّع مجموعات ناقصة، فالاستدعاء الغلط بيتوقف عند منتجه بدل ما يكتب حدثاً باطلاً (FR-049).
 */
export class CommissionBlockNoticeGroupSizeError extends Error {
  readonly code = 'COMMISSION_BLOCK_NOTICE_GROUP_SIZE_INVALID';
  readonly size: number;

  /**
   * يحتفظ بالحجم المرفوض حتى يصلح صاحب الاستدعاء الثابت أو المُدخل.
   *
   * @param size حجم المجموعة المرفوض
   */
  constructor(size: number) {
    super(`Invalid commission block notice group size: ${size}`);
    this.name = 'CommissionBlockNoticeGroupSizeError';
    this.size = size;
  }
}

/** شهر غير صالح؛ شهر غلط كان بيخلي حلقة الأشهر ما تخلصش أبداً. */
export class CommissionPeriodInvalidError extends Error {
  readonly code = 'COMMISSION_PERIOD_INVALID';
  readonly period: string;

  /**
   * يحتفظ بالقيمة المرفوضة حتى يظهر سبب الرفض بوضوح.
   *
   * @param period الشهر المرفوض
   */
  constructor(period: string) {
    super(`Invalid commission period: ${period}`);
    this.name = 'CommissionPeriodInvalidError';
    this.period = period;
  }
}

/**
 * نطاق شهور المرشحين تجاوز الحد الأقصى؛ القفل بيبقى على عدد شهور محدود، فالفحص بيرفض
 * النطاق الأطول بدل ما ياخد أقفال بلا نهاية.
 */
export class CommissionCandidateRangeExceededError extends Error {
  readonly code = 'COMMISSION_CANDIDATE_RANGE_EXCEEDED';
  readonly maxPeriods: number;

  /**
   * يحتفظ بالحد الأقصى المرفوض حتى يظهر سبب الرفض بوضوح.
   *
   * @param maxPeriods الحد الأقصى المسموح من الشهور
   */
  constructor(maxPeriods: number) {
    super(`Commission candidate range exceeds ${maxPeriods} periods`);
    this.name = 'CommissionCandidateRangeExceededError';
    this.maxPeriods = maxPeriods;
  }
}
