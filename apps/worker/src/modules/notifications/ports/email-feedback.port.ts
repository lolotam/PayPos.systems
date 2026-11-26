import type { ResendRetrievalResult } from '@pospay/notifications';

import type {
  EmailBounceClass,
  EmailFeedbackEventType,
  EmailQuarantineReason,
  EmailSuppressionReason,
  EmailSuppressionSource,
} from '../domain/email-feedback.ts';

/** صف صندوق ردّ المزود كما يخزّنه الاستقبال: معرّفات وأوقات وبصمة الحدث. */
export interface EmailFeedbackRow {
  readonly id: string;
  readonly providerEmailId: string;
  readonly feedbackType: EmailFeedbackEventType;
  readonly bounceClass: EmailBounceClass | null;
  readonly providerTimestamp: Date;
  readonly providerEventDigest: Uint8Array;
  readonly attempts: number;
}

/** الحظر المطلوب على مستوى المنصة: بصمة العنوان ومصدره وسببه. */
export interface EmailFeedbackSuppression {
  readonly recipientHash: Uint8Array;
  readonly hashKeyId: string;
  readonly source: EmailSuppressionSource;
  readonly reason: EmailSuppressionReason;
}

/** طلب تسوية صف الصندوق: التسوية والحظر والتدقيق في معاملة واحدة. */
export interface EmailFeedbackSettleInput {
  readonly inboxId: string;
  readonly at: Date;
  readonly auditId: string;
  readonly suppression: EmailFeedbackSuppression | null;
}

/** صندوق ردّ المزود على مستوى المنصة: صفوف عامة من غير شركة ولا عنوان. */
export interface EmailFeedbackInboxRepository {
  pending(id: string): Promise<EmailFeedbackRow | null>;
  quarantine(id: string, reason: EmailQuarantineReason, at: Date): Promise<void>;
  scheduleRetry(id: string, attempts: number, nextAttemptAt: Date): Promise<void>;
  unconfirmed(): Promise<readonly string[]>;
  due(now: Date): Promise<readonly string[]>;
  confirmEnqueue(id: string, at: Date): Promise<void>;
  clearPayloads(cutoff: Date): Promise<number>;
  settle(input: EmailFeedbackSettleInput): Promise<boolean>;
}

/** مدخلات خطوة الشركة: المحاولة والهدف والدليل. */
export interface EmailFeedbackTenantInput {
  readonly companyId: string;
  readonly attemptId: string;
  readonly executionId: string;
  readonly providerEmailId: string;
  readonly recipientHash: Uint8Array;
  readonly hashKeyId: string;
  readonly feedbackId: string;
  readonly feedbackType: EmailFeedbackEventType;
  readonly bounceClass: EmailBounceClass | null;
  readonly providerEventDigest: Uint8Array;
  readonly providerTimestamp: Date;
  readonly recordedAt: Date;
}

/** نتيجة خطوة الشركة: مقبولة أو مرفوضة بسبب تعطيل ثابت. */
export type EmailFeedbackTenantOutcome =
  | { readonly ok: true; readonly bound: boolean; readonly recorded: boolean }
  | { readonly ok: false; readonly reason: EmailQuarantineReason };

/** خطوة الشركة: القفل وتقييم الربط وإثبات الدليل في معاملة مستأجر واحدة. */
export interface EmailFeedbackTenantRepository {
  reconcile(input: EmailFeedbackTenantInput): Promise<EmailFeedbackTenantOutcome>;
}

/** استرجاع الإيميل المرسل من المزود خارج أي معاملة قاعدة بيانات. */
export interface EmailRetrievalPort {
  retrieve(providerEmailId: string): Promise<ResendRetrievalResult>;
}

/** طابور ردّ المزود: يقبل معرّف صف الصندوق فقط. */
export interface EmailFeedbackQueue {
  enqueue(id: string): Promise<void>;
}
