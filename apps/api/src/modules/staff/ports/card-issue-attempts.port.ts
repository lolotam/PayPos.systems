/** قرار احتساب محاولة إصدار: جديدة، أو إعادة مفتاح مكتمل، أو تجاوز السقف مع الثواني الباقية. */
export type CardIssueAttemptDecision =
  | { readonly outcome: 'accepted' }
  | { readonly outcome: 'replay' }
  | { readonly outcome: 'limited'; readonly retryAfterSeconds: number };

/** عدّاد محاولات إصدار الكارت. Redis خلف المنفذ؛ حالة الاستخدام لا تراه. */
export interface CardIssueAttempts {
  /**
   * يحتسب محاولة جديدة أو يميّز إعادة مفتاح مكتمل بنفس البصمة.
   * العلامة في Redis تُشتق بـ HMAC لغرض مستقل، فبصمة الكود غير المفتاحية لا تُخزَّن.
   *
   * @param companyId الشركة
   * @param userId المستخدم الذي يحاول الإصدار
   * @param idempotencyKey مفتاح منع التكرار
   * @param fingerprint بصمة الطلب؛ تدخل المفتاح السري ولا تُكتب في Redis كما هي
   * @returns accepted داخل السقف، replay لنفس البصمة، limited مع الثواني الباقية في الشباك
   */
  take(
    companyId: string,
    userId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<CardIssueAttemptDecision>;
  /**
   * يثبت اكتمال المفتاح حتى لا تُحتسب إعادته داخل الساعة.
   * الفشل يعني أن العلامة لم تُحفظ؛ المستدعي يقرر إن كان الإصدار نفسه قد تم.
   *
   * @param companyId الشركة
   * @param userId المستخدم الذي أتم الإصدار
   * @param idempotencyKey مفتاح منع التكرار
   * @param fingerprint بصمة الطلب المكتمل؛ تدخل HMAC ولا تُكتب في Redis كما هي
   */
  complete(
    companyId: string,
    userId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<void>;
}

/** تعذّر استخدام عدّاد المحاولات. لا يحمل تفاصيل الاتصال ولا الكود. */
export class CardIssueAttemptsUnavailableError extends Error {
  /** لا يحمل تفاصيل الاتصال ولا الكود. */
  constructor() {
    super('CARD_ISSUE_ATTEMPTS_UNAVAILABLE');
  }
}
