export const commissionStatementRenderErrors: Record<
  'COMMISSION_STATEMENT_UNAVAILABLE',
  { message_ar: string; message_en: string }
> = {
  COMMISSION_STATEMENT_UNAVAILABLE: {
    message_ar: 'كشف العمولة مش متاح: طلب التصدير مش موجود أو بيانات الصرف المدفوع لسه مش مكتملة.',
    message_en:
      'The commission statement is unavailable: the export request was not found or the paid-cash data is incomplete.',
  },
};
