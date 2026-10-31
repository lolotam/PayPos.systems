import type { BusinessNames } from './business-names.port.ts';

/** صف طلب التقييم كما بتقراه صفحة التقييم: الصلاحية، وحالة الاستهلاك، ولغة العميل ونشاطه. */
export interface RatingViewRow {
  /** آخر لحظة يقبل فيها الرابط؛ بعدها يبقى غير متاح. */
  readonly expiresAt: Date;
  /** وقت استهلاك الرابط، أو null لو لسه ما اتستهلكش. */
  readonly consumedAt: Date | null;
  /** لغة العميل صاحب الرابط — بتحدد اسم النشاط اللي بتظهره الصفحة. */
  readonly locale: 'ar' | 'en';
  /** النشاط صاحب الطلب — اسماه بيتقروا من موديول tenancy. */
  readonly businessId: string;
}

/** مدخلات الاستهلاك: التوكن المتهدور، واللحظة، والنجوم، والملاحظة. */
export interface ConsumeAndRateInput {
  /** بصمة SHA-256 للتوكن. */
  readonly tokenHash: Buffer;
  /** لحظة الاستهلاك — وقت الساعة المحقونة، بعد القفل. */
  readonly now: Date;
  /** عدد النجوم من 1 إلى 5. */
  readonly stars: number;
  /** ملاحظة العميل، أو null لو ما كتبش. */
  readonly comment: string | null;
}

/**
 * حدود معاملة صفحة التقييم: قراءة بس — مفيش قفل ولا كتابة في النطاق ده.
 * الاستثناء المسجّل للقراءة (PP-87.1): صفحة التقييم use case زي أي use case تاني،
 * لكن نطاق معاملته ما فيهوش `lockRequest` ولا `consumeAndRate` — ولا بالأنواع.
 */
export interface RatingViewScope {
  /**
   * بيقرا طلب التقييم ببصمة التوكن من غير قفل — الصفحة تقرأ بس وما بتكتبش.
   *
   * @param tokenHash بصمة SHA-256 للتوكن
   * @returns صف الطلب ولغة العميل ونشاطه، أو null لو التوكن مش ليه طلب
   */
  findView(tokenHash: Buffer): Promise<RatingViewRow | null>;
  /**
   * اسما النشاط من موديول tenancy، على نفس معاملة الطلب.
   *
   * @param businessId النشاط
   * @returns الاسمين، أو null لو النشاط مش موجود
   */
  businessNames(businessId: string): Promise<BusinessNames | null>;
}

/**
 * حدود معاملة إرسال التقييم: قفل الطلب واستهلاكه مع حفظ التقييم ونسبه.
 * الاستهلاك والتقييم في نفس المعاملة: لو فشلت النسبة، بيرجع الاستهلاك كله.
 */
export interface RatingSubmitScope {
  /**
   * بيقفل صف الطلب `FOR UPDATE` عشان طلبين لنفس التوكن ما يستهلكوش مرتين.
   *
   * @param tokenHash بصمة SHA-256 للتوكن
   * @returns true لو الصف اتقفل، وfalse لو التوكن مش ليه طلب
   */
  lockRequest(tokenHash: Buffer): Promise<boolean>;
  /**
   * بيستهلك الطلب ويحفظ التقييم مع نسبة لكل موظف متصوّر في الطلب.
   *
   * @param input بصمة التوكن واللحظة والنجوم والملاحظة
   * @returns true لو اتستهلك الطلب وحُفظ التقييم، وfalse لو الطلب مش متاح
   */
  consumeAndRate(input: ConsumeAndRateInput): Promise<boolean>;
}

/** معاملة صفحة التقييم: بتعمل جوه الشركة المختارة من بادئة الرابط (ADR-0011 §1). */
export interface RatingViewTransactions {
  /**
   * ينفّذ القراءة جوه معاملة الشركة، ويقفل الشبكة لو اتأخر.
   *
   * @param companyId الشركة المختارة من بادئة الرابط
   * @param work      شغل القراءة جوه المعاملة
   * @returns نتيجة العمل بعد نجاح المعاملة
   */
  run<T>(companyId: string, work: (scope: RatingViewScope) => Promise<T>): Promise<T>;
}

/** معاملة إرسال التقييم: بتعمل جوه الشركة المختارة من بادئة الرابط (ADR-0011 §1). */
export interface RatingSubmitTransactions {
  /**
   * ينفّذ الشغل جوه معاملة الشركة، ويقفل الشبكة لو اتأخر.
   *
   * @param companyId الشركة المختارة من بادئة الرابط
   * @param work      شغل الاستهلاك جوه المعاملة
   * @returns نتيجة العمل بعد نجاح المعاملة
   */
  run<T>(companyId: string, work: (scope: RatingSubmitScope) => Promise<T>): Promise<T>;
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
