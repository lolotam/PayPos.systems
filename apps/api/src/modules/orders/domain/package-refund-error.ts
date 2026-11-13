/** أسباب رفض استرداد الباقة المتوقعة، مستقلة عن HTTP وتفاصيل السائق. */
export type PackageRefundErrorCode =
  | 'PACKAGE_NOT_FOUND'
  | 'PACKAGE_COMPONENT_NOT_FOUND'
  | 'PACKAGE_REFUND_REASON_INVALID'
  | 'IMPORTED_REFUND_DISABLED'
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | 'IDEMPOTENCY_KEY_REUSED';

/** الرفض المسمّى لاسترداد الباقة؛ طبقة النقل تختار الحالة والرسالتين. */
export class PackageRefundError extends Error {
  /**
   * يثبت كود الرفض الآمن من غير سبب الاسترداد أو بيانات العميلة.
   *
   * @param code سبب الرفض المتوقع
   */
  constructor(readonly code: PackageRefundErrorCode) {
    super(code);
    this.name = 'PackageRefundError';
  }
}
