/** سبب عدم توفّر كشف العمولة: طلب التصدير مش موجود، أو بيانات الصرف المدفوع لسه ناقصة. */
export type CommissionStatementUnavailableReason = 'REQUEST_MISSING' | 'PAYMENT_DATA_UNAVAILABLE';

/**
 * كشف العمولة مالوش محتوى جاهز: طلب التصدير مش موجود في المستأجر، أو سجل الصرف
 * المدفوع لسه مش متاح. الفشل نهائي من أول مرة، لأن إعادة المحاولة مش هتجيب الداتا،
 * وبيقفل بكود مخصوص في العقد عشان شاشة العمولة ما تورّتش رسالة كشف الحضور الفاضي.
 */
export class CommissionStatementUnavailableError extends Error {
  readonly code = 'COMMISSION_STATEMENT_UNAVAILABLE' as const;

  constructor(readonly reason: CommissionStatementUnavailableReason) {
    super('COMMISSION_STATEMENT_UNAVAILABLE');
    this.name = 'CommissionStatementUnavailableError';
  }
}
