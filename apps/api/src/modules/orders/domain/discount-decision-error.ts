/** أسباب رفض قرار الخصم المعروفة، دون أخطاء البنية أو بيانات خاصة. */
export type DiscountDecisionErrorCode =
  | 'DISCOUNT_PROPOSAL_NOT_PENDING'
  | 'DISCOUNT_PROPOSAL_CHANGED'
  | 'DISCOUNT_APPROVER_LIMIT_TOO_LOW'
  | 'DISCOUNT_APPROVER_IS_REQUESTER'
  | 'DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED'
  | 'DISCOUNT_REJECT_REASON_INVALID';

/** رفض قرار متوقع يحمل رمزاً وتفاصيل آمنة للعرض، لا خطأً عاماً مبهمًا. */
export class DiscountDecisionError extends Error {
  /**
   * يثبت سبب رفض القرار وتفاصيله.
   *
   * @param code رمز الرفض المعروف
   * @param details معرّف الاقتراح أو الحدود اللازمة للتصحيح، بلا بيانات خاصة
   */
  constructor(readonly code: DiscountDecisionErrorCode, readonly details?: unknown) {
    super(code);
  }
}
