/** أسباب رفض طلب التصدير أو استلامه، وبتترجم لكود API في طبقة HTTP. */
export type StatementExportErrorCode =
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | 'NOT_APPROVED'
  | 'RATE_LIMITED'
  | 'TRANSPORT_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'NOT_READY'
  | 'EXPIRED';

/** رفض طلب التصدير أو استلامه بكود مستقل عن HTTP. */
export class StatementExportError extends Error {
  /**
   * يحفظ سبب الرفض دون كشف بيانات نشاط أو مستند لمستخدم غير مصرح له.
   *
   * @param code كود الرفض
   */
  constructor(readonly code: StatementExportErrorCode) {
    super(code);
    this.name = 'StatementExportError';
  }
}
