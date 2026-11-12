/** أسباب رفض تمديد الباقة المتوقعة، مستقلة عن HTTP وتفاصيل السائق. */
export type PackageExtensionErrorCode =
  | 'PACKAGE_NOT_FOUND'
  | 'PACKAGE_EXPIRY_STALE'
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | 'IDEMPOTENCY_KEY_REUSED';

/** الرفض المسمّى لتمديد الباقة؛ طبقة النقل تختار الحالة والرسالتين. */
export class PackageExtensionError extends Error {
  /**
   * يثبت كود الرفض الآمن من غير سبب التمديد أو بيانات العميلة.
   *
   * @param code سبب الرفض المتوقع
   */
  constructor(readonly code: PackageExtensionErrorCode) {
    super(code);
    this.name = 'PackageExtensionError';
  }
}
