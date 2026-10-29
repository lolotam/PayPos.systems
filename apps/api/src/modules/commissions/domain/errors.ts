export type CommissionPlanVersionErrorCode =
  | 'FORBIDDEN'
  | 'EMPLOYEE_NOT_FOUND'
  | 'COMMISSION_PLAN_INVALID'
  | 'COMMISSION_EFFECTIVE_FROM_PAST'
  | 'COMMISSION_PERIOD_NOT_DRAFT'
  | 'COMMISSION_PERIOD_CLOSED';

/** رفض إنشاء إصدار خطة بكود مستقل عن HTTP، وتفاصيل كود المحرك عند الحاجة. */
export class CommissionPlanVersionError extends Error {
  readonly code: CommissionPlanVersionErrorCode;
  readonly details: unknown;

  /**
   * يحتفظ بكود الرفض وتفاصيله حتى تترجمه طبقة HTTP دون أن يعرف الـ domain بها.
   *
   * @param code كود رفض إصدار الخطة
   * @param details تفاصيل اختيارية مثل كود رفض محرك العمولة
   */
  constructor(code: CommissionPlanVersionErrorCode, details?: unknown) {
    super(code);
    this.name = 'CommissionPlanVersionError';
    this.code = code;
    this.details = details;
  }
}
