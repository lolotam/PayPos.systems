/** أسباب رفض الكتابة على مستوى القاعدة، ويمسكها الـ domain بدل رموز HTTP حتى تبقى الترجمة في طبقة HTTP. */
export type CommissionPlanVersionErrorCode =
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | 'EMPLOYEE_NOT_FOUND'
  | 'SERVICE_NOT_FOUND'
  | 'COMMISSION_PLAN_INVALID'
  | 'COMMISSION_EFFECTIVE_FROM_PAST'
  | 'COMMISSION_PERIOD_BEFORE_BUSINESS'
  | 'COMMISSION_PERIOD_NOT_DRAFT'
  | 'COMMISSION_PERIOD_CLOSED'
  | 'COMMISSION_REPAIR_NOT_ALLOWED'
  | 'COMMISSION_PERIOD_NOT_ENDED'
  | 'COMMISSION_STATEMENT_BLOCKED'
  | 'COMMISSION_FINGERPRINT_STALE'
  | 'COMMISSION_RETURN_REASON_INVALID'
  | 'COMMISSION_STATEMENT_NOT_REVIEWED'
  | 'TRANSACTION_RETRY_REQUIRED';

/** رفض الكتابة بكود مستقل عن HTTP، وتفاصيل كود المحرك عند الحاجة. */
export class CommissionPlanVersionError extends Error {
  readonly code: CommissionPlanVersionErrorCode;
  readonly details: unknown;

  /**
   * يحتفظ بكود الرفض وتفاصيله حتى تترجمه طبقة HTTP دون أن يعرف الـ domain بها.
   *
   * @param code كود رفض الكتابة في تعديلات العمولة
   * @param details تفاصيل اختيارية مثل كود رفض محرك العمولة
   */
  constructor(code: CommissionPlanVersionErrorCode, details?: unknown) {
    super(code);
    this.name = 'CommissionPlanVersionError';
    this.code = code;
    this.details = details;
  }
}
