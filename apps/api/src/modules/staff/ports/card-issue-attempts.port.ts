/** قرار احتساب محاولة إصدار: جديدة، أو إعادة مفتاح مكتمل، أو تجاوز السقف. */
export type CardIssueAttemptDecision = 'accepted' | 'replay' | 'limited';

/** عدّاد محاولات إصدار الكارت. Redis خلف المنفذ؛ حالة الاستخدام لا تراه. */
export interface CardIssueAttempts {
  /**
   * يحتسب محاولة جديدة أو يميّز إعادة مفتاح مكتمل بنفس البصمة.
   *
   * @param companyId الشركة
   * @param userId المستخدم الذي يحاول الإصدار
   * @param idempotencyKey مفتاح منع التكرار
   * @param fingerprint بصمة الطلب
   * @returns accepted داخل السقف، replay لنفس البصمة، limited بعد السقف
   */
  take(
    companyId: string,
    userId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<CardIssueAttemptDecision>;
  /**
   * يثبت اكتمال المفتاح حتى لا تُحتسب إعادته داخل الساعة.
   *
   * @param companyId الشركة
   * @param userId المستخدم الذي أتم الإصدار
   * @param idempotencyKey مفتاح منع التكرار
   * @param fingerprint بصمة الطلب المكتمل
   */
  complete(
    companyId: string,
    userId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<void>;
}

/** Redis الحد غير متاح؛ الإصدار يفشل مغلقاً ولا يكتب كارتاً. */
export class CardIssueAttemptsUnavailableError extends Error {
  /** لا يحمل تفاصيل الاتصال ولا الكود. */
  constructor() {
    super('CARD_ISSUE_ATTEMPTS_UNAVAILABLE');
  }
}
