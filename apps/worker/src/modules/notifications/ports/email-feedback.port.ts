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
  /**
   * يقرأ صفًا مفتوحًا.
   *
   * @param id معرّف الصف
   * @returns الصف أو null
   */
  pending(id: string): Promise<EmailFeedbackRow | null>;
  /**
   * يعطّل الصف بسبب ثابت.
   *
   * @param id المعرّف
   * @param reason السبب
   * @param at الوقت
   */
  quarantine(id: string, reason: EmailQuarantineReason, at: Date): Promise<void>;
  /**
   * يجدول إعادة محاولة.
   *
   * @param id المعرّف
   * @param attempts العدد
   * @param nextAttemptAt الموعد
   */
  scheduleRetry(id: string, attempts: number, nextAttemptAt: Date): Promise<void>;
  /**
   * صفوف لم يؤكَّد إرسالها للطابور.
   *
   * @returns المعرّفات
   */
  unconfirmed(): Promise<readonly string[]>;
  /**
   * صفوف مستحقة للإعادة.
   *
   * @param now الوقت الحالي
   * @returns المعرّفات
   */
  due(now: Date): Promise<readonly string[]>;
  /**
   * يؤكد التسليم للطابور.
   *
   * @param id المعرّف
   * @param at الوقت
   */
  confirmEnqueue(id: string, at: Date): Promise<void>;
  /**
   * يمسح الحمولة الخام بعد المدة.
   *
   * @param cutoff الحد الزمني
   * @returns عدد الصفوف
   */
  clearPayloads(cutoff: Date): Promise<number>;
  /**
   * يسوّي الصف ويكتب المنع والتدقيق.
   *
   * @param input المدخلات
   * @returns هل تمت التسوية
   */
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
  /**
   * ينفّذ الربط وإثبات الدليل في الشركة.
   *
   * @param input المدخلات
   * @returns النتيجة
   */
  reconcile(input: EmailFeedbackTenantInput): Promise<EmailFeedbackTenantOutcome>;
}

/** استرجاع الإيميل المرسل من المزود خارج أي معاملة قاعدة بيانات. */
export interface EmailRetrievalPort {
  /**
   * يسترجع الوسوم والبصمة.
   *
   * @param providerEmailId معرّف المزود
   * @returns النتيجة
   */
  retrieve(providerEmailId: string): Promise<ResendRetrievalResult>;
}

/** طابور ردّ المزود: يقبل معرّف صف الصندوق فقط. */
export interface EmailFeedbackQueue {
  /**
   * يضيف الصف للطابور.
   *
   * @param id المعرّف
   */
  enqueue(id: string): Promise<void>;
}
