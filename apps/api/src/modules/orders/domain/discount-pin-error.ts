/** أسباب رفض التحقق من الرقم السري المعروفة، بلا رقم سري ولا هاتف ولا تجزئة. */
export type DiscountPinErrorCode = 'PIN_INVALID' | 'PIN_LOCKED' | 'TOO_MANY_REQUESTS' | 'NOT_READY';

/** رفض متوقع من التحقق من الرقم السري؛ يحمل رمزاً معروفاً وبلا أي بيانات سرية. */
export class DiscountPinError extends Error {
  /**
   * يثبت سبب رفض التحقق من الرقم السري.
   *
   * @param code رمز الرفض المعروف
   */
  constructor(readonly code: DiscountPinErrorCode) {
    super(code);
  }
}
