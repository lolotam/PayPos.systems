import type { ResendRetrievalResult } from '@pospay/notifications';

import type {
  EmailBounceClass,
  EmailFeedbackEventType,
  EmailQuarantineReason,
  EmailSuppressionReason,
  EmailSuppressionSource,
} from '../domain/email-feedback.ts';

/** صف صندوق ردّ المزود كما يخزّنه الاستقبال: معرّفات وأوقات وخلاص. */
export interface EmailFeedbackRow {
  /** معرّف صف الصندوق. */
  readonly id: string;
  /** معرّف الإيميل عند المزود؛ ده اللي بيتسترجع. */
  readonly providerEmailId: string;
  /** نوع الحدث المسموح به. */
  readonly eventType: EmailFeedbackEventType;
  /** تصنيف الارتداد لو الحدث ارتداد. */
  readonly bounceClass: EmailBounceClass | null;
  /** وقت المزود للحدث. */
  readonly providerTimestamp: Date;
  /** البصمة الدائمة للحدث؛ بتربطه بدليل الشركة. */
  readonly providerEventDigest: Uint8Array;
  /** عدد المحاولات الفاشلة لحد دلوقتي. */
  readonly attempts: number;
}

/** الحظر المطلوب على مستوى المنصة: بصمة العنوان ومصدره. */
export interface EmailFeedbackSuppression {
  /** بصمة الوجهة؛ العنوان نفسه ما بيوصلش لحد. */
  readonly recipientHash: Uint8Array;
  /** معرّف مفتاح البصمة. */
  readonly hashKeyId: string;
  /** مصدر الحظر. */
  readonly source: EmailSuppressionSource;
  /** سبب الحظر الثابت. */
  readonly reason: EmailSuppressionReason;
}

/** طلب تسوية صف الصندوق: التسوية والحظر والتدقيق كلهم في معاملة واحدة. */
export interface EmailFeedbackSettleInput {
  /** صف الصندوق. */
  readonly inboxId: string;
  /** وقت التسوية. */
  readonly at: Date;
  /** معرّف سجل التدقيق؛ العامل بيولّده مش عشوائية جوه القاعدة. */
  readonly auditId: string;
  /** الحظر المطلوب؛ null يعني دليل من غير حظر. */
  readonly suppression: EmailFeedbackSuppression | null;
}

/** صندوق ردّ المزود على مستوى المنصة: صفوف عامة من غير شركة ولا عنوان. */
export interface EmailFeedbackInboxRepository {
  /**
   * يقرأ صف الصندوق لو لسه مفتوح: مش محلول ومش معطّل.
   *
   * @param id معرّف صف الصندوق
   * @returns الصف المفتوح أو null
   */
  pending(id: string): Promise<EmailFeedbackRow | null>;
  /**
   * يعطّل الصف بسبب ثابت؛ التكرار آمن لأن التعطيل بيتكتب مرة واحدة.
   *
   * @param id معرّف صف الصندوق
   * @param reason سبب التعطيل
   * @param at وقت التعطيل
   */
  quarantine(id: string, reason: EmailQuarantineReason, at: Date): Promise<void>;
  /**
   * يسجّل محاولة فاشلة جديدة ويحدد موعد المحاولة الجاية.
   *
   * @param id معرّف صف الصندوق
   * @param attempts عدد المحاولات بعد الفشل
   * @param nextAttemptAt موعد المحاولة الجاية
   */
  scheduleRetry(id: string, attempts: number, nextAttemptAt: Date): Promise<void>;
  /**
   * الصفوف اللي اتخزنت وما اتأكدش تسليمها للطابور.
   *
   * @returns معرّفات الصفوف
   */
  unconfirmed(): Promise<readonly string[]>;
  /**
   * الصفوف المفتوحة اللي موعد المحاولة الجاية لها جه.
   *
   * @param now وقت الفحص
   * @returns معرّفات الصفوف
   */
  due(now: Date): Promise<readonly string[]>;
  /**
   * يثبت إن الصف اتسلم للطابور.
   *
   * @param id معرّف صف الصندوق
   * @param at وقت التأكيد
   */
  confirmEnqueue(id: string, at: Date): Promise<void>;
  /**
   * يمسح الحمولة الخام بعد مدة الاحتفاظ ويبقي البصمة والحالة.
   *
   * @param cutoff حد الاحتفاظ
   * @returns عدد الصفوف اللي اتمسحت
   */
  clearPayloads(cutoff: Date): Promise<number>;
  /**
   * يسوّي الصف: يعلّمه محلولاً، ويمرّر الحظر وسجل التدقيق في نفس المعاملة.
   *
   * @param input طلب التسوية
   * @returns هل الصف اتسوّى في النداء ده
   */
  settle(input: EmailFeedbackSettleInput): Promise<boolean>;
}

/** مدخلات خطوة الشركة: المحاولة والهدف والدليل. */
export interface EmailFeedbackTenantInput {
  /** الشركة اللي فيها المحاولة. */
  readonly companyId: string;
  /** المحاولة المقفولة. */
  readonly attemptId: string;
  /** سياج التنفيذ اللي في وسم المزود. */
  readonly executionId: string;
  /** معرّف الإيميل عند المزود. */
  readonly providerEmailId: string;
  /** بصمة الوجهة المسترجعة. */
  readonly recipientHash: Uint8Array;
  /** معرّف مفتاح البصمة. */
  readonly hashKeyId: string;
  /** معرّف دليل الشركة. */
  readonly feedbackId: string;
  /** نوع الحدث. */
  readonly eventType: EmailFeedbackEventType;
  /** تصنيف الارتداد. */
  readonly bounceClass: EmailBounceClass | null;
  /** البصمة الدائمة للحدث. */
  readonly providerEventDigest: Uint8Array;
  /** وقت المزود للحدث. */
  readonly providerTimestamp: Date;
  /** وقت تسجيل الدليل. */
  readonly recordedAt: Date;
}

/** نتيجة خطوة الشركة: مقبولة أو مرفوضة بسبب تعطيل ثابت. */
export type EmailFeedbackTenantOutcome =
  | { readonly ok: true; readonly bound: boolean; readonly recorded: boolean }
  | { readonly ok: false; readonly reason: EmailQuarantineReason };

/** خطوة الشركة كلها: القفل وتقييم الربط وإثبات الدليل في معاملة واحدة. */
export interface EmailFeedbackTenantRepository {
  /**
   * يقفل المحاولة ويقيّم الربط ويثبت الدليل؛ الرفض بيكتب ولا حاجة في الشركة.
   *
   * @param input مدخلات خطوة الشركة
   * @returns نتيجة الخطوة
   */
  reconcile(input: EmailFeedbackTenantInput): Promise<EmailFeedbackTenantOutcome>;
}

/** استرجاع الإيميل المرسل من المزود؛ بيحصل بره أي معاملة. */
export interface EmailRetrievalPort {
  /**
   * يسترجع الإيميل ووسومه من المزود.
   *
   * @param providerEmailId معرّف الإيميل عند المزود
   * @returns الوسوم والبصمة أو رفض أو فشل مؤقت
   */
  retrieve(providerEmailId: string): Promise<ResendRetrievalResult>;
}

/** طابور ردّ المزود: شغل بالـ id بس. */
export interface EmailFeedbackQueue {
  /**
   * يسلّم الصف للطابور.
   *
   * @param id معرّف صف الصندوق
   */
  enqueue(id: string): Promise<void>;
}
