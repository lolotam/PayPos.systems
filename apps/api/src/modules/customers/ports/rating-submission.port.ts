/** صف طلب التقييم كما بتقراه صفحة التقييم: الصلاحية، وحالة الاستهلاك، ولغة العميل واسم نشاطه. */
export interface RatingViewRow {
  /** آخر لحظة يقبل فيها الرابط؛ بعدها يبقى غير متاح. */
  readonly expiresAt: Date;
  /** وقت استهلاك الرابط، أو null لو لسه ما اتستهلكش. */
  readonly consumedAt: Date | null;
  /** لغة العميل صاحب الرابط — بتحدد اسم النشاط اللي بتظهره الصفحة. */
  readonly locale: 'ar' | 'en';
  /** الاسم العربي للنشاط، أو null لو مش محفوظ. */
  readonly nameAr: string | null;
  /** الاسم الإنجليزي للنشاط — دايماً موجود. */
  readonly nameEn: string;
}

/** مدخلات الاستهلاك: التوكن المتهدور، واللحظة، والنجوم، والملاحظة. */
export interface ConsumeAndRateInput {
  /** بصمة SHA-256 للتوكن. */
  readonly tokenHash: Buffer;
  /** لحظة الاستهلاك — وقت الداتابيز جوه المعاملة. */
  readonly now: Date;
  /** عدد النجوم من 1 إلى 5. */
  readonly stars: number;
  /** ملاحظة العميل، أو null لو ما كتبش. */
  readonly comment: string | null;
}

/** حدود المعاملة: قراءة الصفحة، وقفل الطلب، والاستهلاك مع حفظ التقييم ونسبه. */
export interface RatingSubmissionScope {
  /**
   * بيقرا طلب التقييم ببصمة التوكن من غير قفل — الصفحة تقرأ بس وما بتكتبش.
   *
   * @param tokenHash بصمة SHA-256 للتوكن
   * @returns صف الطلب ولغة العميل واسم النشاط، أو null لو التوكن مش ليه طلب
   */
  findView(tokenHash: Buffer): Promise<RatingViewRow | null>;
  /**
   * بيقفل صف الطلب `FOR UPDATE` عشان طلبين لنفس التوكن ما يستهلكوش مرتين.
   *
   * @param tokenHash بصمة SHA-256 للتوكن
   * @returns true لو الصف اتقفل، وfalse لو التوكن مش ليه طلب
   */
  lockRequest(tokenHash: Buffer): Promise<boolean>;
  /**
   * بيستهلك الطلب ويحفظ التقييم مع نسبة لكل موظف متصوّر في الطلب.
   * الاستهلاك والتقييم في نفس المعاملة: لو فشلت النسبة، بيرجع الاستهلاك كله.
   *
   * @param input بصمة التوكن واللحظة والنجوم والملاحظة
   * @returns true لو اتستهلك الطلب وحُفظ التقييم، وfalse لو الطلب مش متاح
   */
  consumeAndRate(input: ConsumeAndRateInput): Promise<boolean>;
}

/** معاملة تقييم العميل: بتعمل جوه الشركة المختارة من بادئة الرابط (ADR-0011 §1). */
export interface RatingSubmissionTransactions {
  /**
   * ينفّذ العمل جوه معاملة الشركة، ويقفل الشبكة لو اتأخر.
   *
   * @param companyId الشركة المختارة من بادئة الرابط
   * @param work      عمل التقييم جوه المعاملة
   * @returns نتيجة العمل بعد نجاح المعاملة
   */
  run<T>(companyId: string, work: (scope: RatingSubmissionScope) => Promise<T>): Promise<T>;
}

/**
 * القفل ما اتاخدش في الوقت: مهلة المعاملة خلصت، أو نتيجة الـ commit اتلغبطت، أو PostgreSQL
 * رفض الانتظار على القفل. الخطأ جزء من عقد المعاملة مش من HTTP — التحويل مسؤولية المستهلك.
 */
export class RatingSubmissionBusyError extends Error {
  /** لا يحمل بصمة التوكن ولا معرّف العميل ولا تفاصيل الاتصال. */
  constructor() {
    super('RATING_SUBMISSION_BUSY');
    this.name = 'RatingSubmissionBusyError';
  }
}
