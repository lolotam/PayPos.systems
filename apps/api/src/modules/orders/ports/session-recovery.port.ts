/** عملية الكتابة التي يصدر لها إثبات الاسترجاع. */
export type SessionRecoveryOperation = 'record-service-session' | 'append-service-session-lines';

/** هوية المحاولة كما تصل من الكتابة؛ المفتاح الخام يُهاش في الـ adapter ولا يُخزَّن. */
export interface SessionRecoveryIssue {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  operation: SessionRecoveryOperation;
  key: string;
  sessionId?: string | undefined;
  recorderMembershipId?: string | undefined;
  occurredAt?: Date | undefined;
}

/** إصدار الإثبات معزول عن معاملة المال حتى يبقى الأثر لو تراجعت الكتابة. */
export interface SessionRecoveryPort {
  /**
   * يصدر إثبات الاسترجاع ويلتزم به قبل الكتابة حتى يبقى أثر المحاولة لو تراجعت معاملة المال.
   *
   * @param input هوية المحاولة والمفتاح الخام ونطاقها ووقت التنفيذ الاختياري
   * @returns يكتمل بعد commit الإثبات؛ رفض السلطة أو النافذة يبقى خطأ الكتابة نفسه بلا صف
   */
  issue(input: SessionRecoveryIssue): Promise<void>;
}
