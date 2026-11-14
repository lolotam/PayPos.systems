export type CommissionLineStatus = 'ACTIVE' | 'CANCELLED';

export type CommissionLineRuleSnapshot =
  | { readonly kind: 'FOLLOW_PLAN' | 'ZERO' }
  | { readonly kind: 'PCT'; readonly value: number }
  | { readonly kind: 'FIXED'; readonly value: string };

export interface CommissionLinePerformer {
  readonly employeeId: string;
  readonly shareBps: number;
}

export interface CommissionLineSnapshot {
  readonly lineId: string;
  readonly sessionId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly serviceId: string;
  readonly customerId: string;
  readonly status: CommissionLineStatus;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly businessDate: string;
  readonly net: string;
  readonly performers: readonly CommissionLinePerformer[];
  readonly ruleSnapshot: CommissionLineRuleSnapshot;
  readonly countsSnapshot: boolean;
  readonly revision: number;
}

export interface CommissionLineEventInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly sessionId: string;
  readonly eventId: string;
  readonly lines: readonly CommissionLineSnapshot[];
}

/** صف منفّذ محفوظ قبل الاستبدال؛ شهره يحدد أي كشف مغلق يحتاج تصحيحاً للموظفة. */
export type CommissionLinePerformerPeriod = {
  readonly lineId: string;
  readonly employeeId: string;
  readonly period: string;
};

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

/** رأس محفوظ بعد قفل البند؛ هويته الخماسية ثابتة حتى لو حمل الحدث الأحدث مراجع مختلفة. */
export interface HeldCommissionLineHead {
  readonly lineId: string;
  readonly businessId: string;
  readonly sessionId: string;
  readonly branchId: string;
  readonly serviceId: string;
  readonly customerId: string;
  readonly revision: number;
  readonly period: string;
}

export interface CommissionRuleColumns {
  readonly ruleKind: CommissionLineRuleSnapshot['kind'];
  readonly rulePctBps: number | null;
  readonly ruleFixedAmount: string | null;
}
