/** أسباب رفض قواعد الباقة مستقلة عن HTTP، عشان نفس الحساب يشتغل من غير سيرفر. */
export type PackageErrorCode =
  | 'INVALID_PRICE'
  | 'INVALID_COMPONENTS'
  | 'DUPLICATE_SERVICE'
  | 'INVALID_SESSIONS'
  | 'INVALID_REMAINING_SESSIONS'
  | 'INVALID_SLOTS'
  | 'INVALID_DATE'
  | 'PACKAGE_EXPIRED'
  | 'INSUFFICIENT_SLOTS';

/** خطأ مسمّى؛ طبقة النقل اللاحقة مسؤولة عن الرسالة العربية والإنجليزية. */
export class PackageRuleError extends Error {
  /**
   * بيثبت سبب الرفض عشان المستهلك يفرّق بين المدخل غير الصالح ونفاد الجلسات.
   *
   * @param code سبب الرفض
   */
  constructor(public readonly code: PackageErrorCode) {
    super(code);
    this.name = 'PackageRuleError';
  }
}
