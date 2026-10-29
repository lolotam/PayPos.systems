/** سبب عدم توفّر كشف العمولة: طلب التصدير مش موجود، أو بيانات الصرف المدفوع لسه ناقصة. */
export type CommissionStatementUnavailableReason = 'REQUEST_MISSING' | 'PAYMENT_DATA_UNAVAILABLE';

/**
 * كشف العمولة مالوش محتوى جاهز: طلب التصدير مش موجود في المستأجر، أو سجل الصرف
 * المدفوع لسه مش متاح. الفشل نهائي من أول مرة، لأن إعادة المحاولة مش هتجيب الداتا.
 * TODO(spec): العقد مفيهوش كود خاص بفشل كشف العمولة، فبنستخدم STATEMENT_EMPTY
 * (الفشل الدائم الوحيد في العقد) لحد ما يتضاف كود مخصوص في شريحة تانية.
 */
export class CommissionStatementUnavailableError extends Error {
  readonly code = 'STATEMENT_EMPTY' as const;

  constructor(readonly reason: CommissionStatementUnavailableReason) {
    super('STATEMENT_EMPTY');
    this.name = 'CommissionStatementUnavailableError';
  }
}
