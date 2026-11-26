/** أقصى عدد محاولات لاسترجاع الإيميل قبل تعطيل الصف (spec 075 FR-014). */
export const MAX_FEEDBACK_ATTEMPTS = 8;
/** أقصى مسافة بين محاولتين؛ المباعدة أسية بتتضاعف لحد السقف ده. */
export const MAX_FEEDBACK_BACKOFF_MS = 6 * 60 * 60 * 1000;
const BASE_FEEDBACK_BACKOFF_MS = 10 * 60 * 1000;

/** نوع الحدث المسموح به من المزود؛ القائمة مغلقة على الستة بس. */
export type EmailFeedbackEventType =
  | 'email.delivered'
  | 'email.bounced'
  | 'email.complained'
  | 'email.failed'
  | 'email.suppressed'
  | 'email.delivery_delayed';

/** تصنيف الارتداد عندنا: دائم بيحظر، ومؤقت دليل بس. */
export type EmailBounceClass = 'PERMANENT' | 'TRANSIENT';

/** مصدر الحظر على مستوى المنصة؛ بيكتب في سجل التدقيق كمان. */
export type EmailSuppressionSource = 'BOUNCE' | 'COMPLAINT' | 'PROVIDER';

/** سبب الحظر الثابت اللي سجل التدقيق بيحمله. */
export type EmailSuppressionReason = 'PERMANENT_BOUNCE' | 'COMPLAINT' | 'PROVIDER_SUPPRESSION';

/** أسباب تعطيل صف الصندوق؛ من غير سبب الصف بيفضل شارد ومحدش بيفهمه. */
export type EmailQuarantineReason =
  | 'ATTEMPT_NOT_FOUND'
  | 'CROSS_TENANT'
  | 'HASH_MISMATCH'
  | 'EXECUTION_MISSING'
  | 'PROVIDER_ID_CONFLICT'
  | 'STATE_INELIGIBLE'
  | 'TAGS_INVALID'
  | 'RETRIEVAL_EXHAUSTED';

/** لقطة المحاولة وقت الربط: القيم اللي القاعدة بتسمح نقراها ونقارنها. */
export interface AttemptBindingSnapshot {
  readonly companyId: string;
  readonly channel: string;
  readonly executionId: string | null;
  readonly status: string;
  readonly outcomeKnown: boolean | null;
  readonly providerMessageId: string | null;
  readonly recipientHash: Uint8Array;
  readonly hashKeyId: string;
}

/** الهدف اللي رجع من استرجاع المزود: الوسوم والبصمة. */
export interface RetrievedBindingTarget {
  readonly companyId: string;
  readonly executionId: string;
  readonly providerEmailId: string;
  readonly recipientHash: Uint8Array;
  readonly hashKeyId: string;
}

/** قرار الربط: مقبول، أو مرفوض بسبب تعطيل ثابت. */
export type AttemptBindingDecision =
  | { readonly ok: true; readonly bindProviderMessageId: boolean }
  | { readonly ok: false; readonly reason: EmailQuarantineReason };

/** قرار الحظر: هتتكتب حالة حظر وسجل تدقيق، ولا الدليل بس. */
export type EmailFeedbackDecision =
  | { readonly suppress: false }
  | {
      readonly suppress: true;
      readonly source: EmailSuppressionSource;
      readonly reason: EmailSuppressionReason;
    };

/**
 * يقرر هل الحدث يمنع العنوان (شكوى، منع مزود، ارتداد دائم) أم دليل فقط.
 *
 * @param feedbackType نوع الحدث
 * @param bounceClass تصنيف الارتداد
 * @returns قرار الحظر
 */
export function emailFeedbackDecision(
  feedbackType: EmailFeedbackEventType,
  bounceClass: EmailBounceClass | null,
): EmailFeedbackDecision {
  if (feedbackType === 'email.complained')
    return { suppress: true, source: 'COMPLAINT', reason: 'COMPLAINT' };
  if (feedbackType === 'email.suppressed')
    return { suppress: true, source: 'PROVIDER', reason: 'PROVIDER_SUPPRESSION' };
  if (feedbackType === 'email.bounced' && bounceClass === 'PERMANENT')
    return { suppress: true, source: 'BOUNCE', reason: 'PERMANENT_BOUNCE' };
  return { suppress: false };
}

/**
 * يقيّم انتماء ردّ المزود لمحاولتنا ويرجع هل نربط معرّف المزود أم نعطّل الصف.
 *
 * @param attempt لقطة المحاولة المقفولة
 * @param target الهدف المسترجع
 * @returns قرار الربط
 */
export function evaluateAttemptBinding(
  attempt: AttemptBindingSnapshot | null,
  target: RetrievedBindingTarget,
): AttemptBindingDecision {
  if (attempt === null) return { ok: false, reason: 'ATTEMPT_NOT_FOUND' };
  if (attempt.companyId !== target.companyId) return { ok: false, reason: 'CROSS_TENANT' };
  if (attempt.channel !== 'email') return { ok: false, reason: 'STATE_INELIGIBLE' };
  if (!attempt.executionId || attempt.executionId !== target.executionId)
    return { ok: false, reason: 'EXECUTION_MISSING' };
  if (
    attempt.hashKeyId !== target.hashKeyId ||
    !sameHash(attempt.recipientHash, target.recipientHash)
  )
    return { ok: false, reason: 'HASH_MISMATCH' };
  if (attempt.providerMessageId !== null && attempt.providerMessageId !== target.providerEmailId)
    return { ok: false, reason: 'PROVIDER_ID_CONFLICT' };
  return bindingState(attempt);
}

/**
 * يقرر موعد المحاولة الجاية بعد فشل مؤقت، أو يعطّل الصف بعد استنفاد المحاولات.
 *
 * @param attemptsAfterFailure عدد المحاولات الفاشلة
 * @param now الوقت الحالي
 * @returns موعد المحاولة أو التعطيل
 */
export function nextFeedbackRetry(
  attemptsAfterFailure: number,
  now: Date,
):
  | { readonly quarantine: 'RETRIEVAL_EXHAUSTED' }
  | { readonly quarantine: null; readonly nextAttemptAt: Date } {
  if (attemptsAfterFailure >= MAX_FEEDBACK_ATTEMPTS) return { quarantine: 'RETRIEVAL_EXHAUSTED' };
  return {
    quarantine: null,
    nextAttemptAt: new Date(now.getTime() + feedbackBackoffMs(attemptsAfterFailure)),
  };
}

function bindingState(attempt: AttemptBindingSnapshot): AttemptBindingDecision {
  const openOutcome = attempt.status === 'FAILED' && attempt.outcomeKnown === false;
  if (attempt.providerMessageId === null) {
    if (attempt.status === 'SENDING' || openOutcome)
      return { ok: true, bindProviderMessageId: true };
    return { ok: false, reason: 'STATE_INELIGIBLE' };
  }
  if (attempt.status === 'SENDING' || attempt.status === 'SENT' || openOutcome)
    return { ok: true, bindProviderMessageId: false };
  return { ok: false, reason: 'STATE_INELIGIBLE' };
}

function feedbackBackoffMs(attemptsAfterFailure: number): number {
  const step = BASE_FEEDBACK_BACKOFF_MS * 2 ** Math.max(0, attemptsAfterFailure - 1);
  return Math.min(MAX_FEEDBACK_BACKOFF_MS, step);
}

// مقارنة ثابتة الزمن بالـ XOR على البايتات: الفرق بيتجمّع في متغير واحد ومفيش مخرجات مبكرة.
function sameHash(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}
