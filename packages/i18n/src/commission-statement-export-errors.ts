// أخطاء تصدير كشف العمولات. `COMMISSION_STATEMENT_NOT_APPROVED` في commission-plan-errors.ts
// لأنه كود مشترك بين الاعتماد والصرف والتصدير، فمش بيتكرر هنا.
export const commissionStatementExportErrorsAr = {
  COMMISSION_STATEMENT_EXPORT_RATE_LIMITED: 'طلبات تصدير كتير، جرّب بعد شوية.',
} as const;

export const commissionStatementExportErrorsEn = {
  COMMISSION_STATEMENT_EXPORT_RATE_LIMITED: 'Too many export requests. Try again later.',
} as const;
