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
  readonly lines: readonly CommissionLineSnapshot[];
}

/** شهر كشف مقفول بحالته بعد أخذ الأقفال؛ حالة الشهر هي التي تقرر إن كان مغلقاً ولا يُفتح. */
export interface LockedCommissionPeriod {
  readonly period: string;
  readonly status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';
}

export interface HeldCommissionLineHead {
  readonly lineId: string;
  readonly revision: number;
  readonly period: string;
}

export interface CommissionRuleColumns {
  readonly ruleKind: CommissionLineRuleSnapshot['kind'];
  readonly rulePctBps: number | null;
  readonly ruleFixedAmount: string | null;
}
