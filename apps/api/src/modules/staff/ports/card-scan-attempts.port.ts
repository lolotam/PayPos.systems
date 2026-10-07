/** قرار فحص مسح الكارت قبل أي بحث: مسموح، أو إعادة مفتاح مكتمل، أو السقف مع الثواني الباقية. */
export type CardScanAttemptDecision =
  | { readonly outcome: 'open' }
  | { readonly outcome: 'replay' }
  | { readonly outcome: 'limited'; readonly remaining: number };

/** عدّاد المسحات الفاشلة لكل جهاز مزدوج. Redis خلف المنفذ؛ حالة الاستخدام لا تراه. */
export interface CardScanAttempts {
  /**
   * يقرأ السقف قبل أي بحث عن الكارت. إعادة مفتاح مكتمل بنفس البصمة لا تُحتسب ولا تُمنع.
   * الفحص لا يحجز الخانة، فدفعة متزامنة قد تتجاوز السقف قليلاً قبل الاحتساب.
   * علامة الاكتمال HMAC لغرض مستقل، فبصمة الطلب غير المفتاحية لا تُكتب في Redis.
   *
   * @param companyId الشركة
   * @param deviceId الجهاز المزدوج
   * @param idempotencyKey مفتاح منع التكرار
   * @param fingerprint بصمة الطلب؛ تدخل المفتاح السري ولا تُكتب في Redis كما هي
   * @returns open تحت السقف، replay لمفتاح مكتمل، limited مع الثواني الباقية؛ صفر من العدّاد يُرفع إلى ثانية حتى لا يُطلب إعادة فورية
   */
  inspect(
    companyId: string,
    deviceId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<CardScanAttemptDecision>;
  /**
   * يحتسب مسحاً رُفض كارتُه بعد معرفة النتيجة.
   *
   * @param companyId الشركة
   * @param deviceId الجهاز المزدوج
   */
  recordFailure(companyId: string, deviceId: string): Promise<void>;
  /**
   * يثبت اكتمال المفتاح حتى لا تُحتسب إعادته داخل الشباك.
   * الفشل يعني أن العلامة لم تُحفظ؛ المستدعي يقرر إن كانت الحركة نفسها قد تمّت.
   *
   * @param companyId الشركة
   * @param deviceId الجهاز الذي أتم المسح
   * @param idempotencyKey مفتاح منع التكرار
   * @param fingerprint بصمة الطلب المكتمل؛ تدخل HMAC ولا تُكتب في Redis كما هي
   */
  complete(
    companyId: string,
    deviceId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<void>;
}

/** Redis الحد غير متاح؛ المسح يفشل مغلقاً ولا يبحث عن الكارت. */
export class CardScanAttemptsUnavailableError extends Error {
  /** لا يحمل تفاصيل الاتصال ولا الكود. */
  constructor() {
    super('CARD_SCAN_ATTEMPTS_UNAVAILABLE');
  }
}
