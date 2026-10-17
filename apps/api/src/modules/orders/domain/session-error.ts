/** الرفض المسمّى لا يحمل خطأ السائق أو بيانات عميلة خاصة إلى النقل. */
export type SessionErrorCode = 'FORBIDDEN' | 'FEATURE_DISABLED' | 'TRANSACTION_RETRY_REQUIRED' | 'IDEMPOTENCY_KEY_REUSED'
  | 'SESSION_CUSTOMER_NOT_FOUND' | 'SESSION_SERVICE_NOT_FOUND' | 'SESSION_PERFORMER_NOT_ELIGIBLE'
  | 'SESSION_PERFORMER_SELF_FORBIDDEN' | 'SESSION_PERFORMER_SHARES_INVALID' | 'SESSION_DISCOUNT_INVALID'
  | 'SESSION_DISCOUNT_ABOVE_LIMIT' | 'SESSION_TIME_IN_FUTURE' | 'SESSION_TIME_TOO_OLD' | 'SESSION_TIME_INVALID'
  | 'SESSION_TOTAL_TOO_LARGE' | 'SESSION_LINE_CAPACITY_EXCEEDED' | 'SESSION_RECORDER_MEMBERSHIP_REQUIRED'
  | 'SESSION_RECOVERY_NOT_FOUND' | 'SESSION_RECOVERY_NOT_YET' | 'SESSION_RECOVERY_CLOSED'
  | 'SESSION_LINE_REVISION_STALE' | 'SESSION_EDIT_NO_CHANGE' | 'SESSION_LINE_NOT_EDITABLE'
  | 'SESSION_EDIT_REASON_INVALID' | 'SESSION_EDITOR_MEMBERSHIP_REQUIRED' | 'SESSION_EDIT_IDENTITY_UNKNOWN';
/** طبقة HTTP تحدد الحالة والترجمة؛ القاعدة تبقى مستقلة عن السيرفر. */
export class SessionError extends Error {
  /**
   * يثبت سبب الرفض وتفاصيل البند الآمنة لعرض التصحيح.
   *
   * @param code سبب الرفض
   * @param details تفاصيل مدخلات الطلب المسموح بعرضها
   */
  constructor(readonly code: SessionErrorCode, readonly details?: unknown) { super(code); }
}
