/** موظفة وشهر مغلق يحتاجان جيل تصحيح واحداً بعد تغيّر البنود. */
export interface CommissionPeriodEmployee {
  readonly period: string;
  readonly employeeId: string;
}

/**
 * شهر كشف مقفول بحالته ومعرف كشفه بعد أخذ الأقفال؛ حالة الشهر هي التي تقرر إن كان
 * مغلقاً ولا يُفتح، ومعرف الكشف هو الذي يحمله التصحيح إلى شهره الهدف.
 */
export interface LockedCommissionPeriod {
  readonly period: string;
  readonly statementId: string;
  readonly status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';
}
