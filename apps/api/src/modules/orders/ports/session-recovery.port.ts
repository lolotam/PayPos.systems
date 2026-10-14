/** عملية الكتابة التي يصدر لها إثبات الاسترجاع. */
export type SessionRecoveryOperation = 'record-service-session' | 'append-service-session-lines';

/** الحقول المشتركة لهوية المحاولة؛ المفتاح الخام يُهاش في الـ adapter ولا يُخزَّن. */
interface SessionRecoveryIssueBase {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  key: string;
  recorderMembershipId?: string | undefined;
}

/** الإنشاء يحمل وقت التنفيذ الاختياري؛ الإلحاق يحمل الجلسة المستهدفة. */
export type SessionRecoveryIssue = SessionRecoveryIssueBase & (
  | { operation: 'record-service-session'; occurredAt?: Date | undefined }
  | { operation: 'append-service-session-lines'; sessionId: string }
);

/** إصدار الإثبات معزول عن معاملة المال حتى يبقى الأثر لو تراجعت الكتابة. */
export interface SessionRecoveryPort {
  /**
   * يصدر إثبات الاسترجاع ويلتزم به قبل الكتابة حتى يبقى أثر المحاولة لو تراجعت معاملة المال.
   *
   * @param input هوية المحاولة. الإلحاق يحمل `sessionId`؛ الإنشاء يحمل `occurredAt` الاختياري
   * @returns يكتمل بعد commit الإثبات. رفض السلطة أو النافذة أو `IDEMPOTENCY_KEY_REUSED` (422) يبقى خطأ الكتابة بلا صف جديد؛ فشل القاعدة يرفع `SESSION_RECOVERY_UNAVAILABLE` (503)
   */
  issue(input: SessionRecoveryIssue): Promise<void>;
}
