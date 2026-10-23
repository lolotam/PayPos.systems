/** أسباب فشل محاولة الدفع: محدودة وآمنة للتشخيص، ومن غير جسم المزود ولا جزء منه. */
export type PushFailureCode =
  | 'DEADLINE_EXPIRED'
  | 'SUBSCRIPTION_GONE'
  | 'SUBSCRIPTION_CHANGED'
  | 'SUBSCRIPTION_REVOKED'
  | 'KEY_ROTATED'
  | 'ADMISSION_REFUSED'
  | 'VAPID_REJECTED'
  | 'PROVIDER_4XX'
  | 'PROVIDER_429'
  | 'PROVIDER_5XX'
  | 'NETWORK_UNKNOWN'
  | 'PARAMETERS_INVALID'
  | 'CONFIG_INVALID';

/** سبب سحب الاشتراك بعد محاولة الدفع: اختفى أو المفتاح اتدار. */
export type PushRevokeReason = 'GONE' | 'KEY_ROTATED';

/** النتيجة النهائية للمحاولة: الحالة وسبب الفشل ومعرفة النتيجة وكود خدمة الدفع. */
export interface PushTerminalResult {
  readonly status: 'SENT' | 'FAILED' | 'EXPIRED';
  readonly failureCode: PushFailureCode | null;
  readonly outcomeKnown: boolean;
  readonly httpStatus: number | null;
}

/** لقطة المحاولة وقت الإرسال: هويتها وقالبها الآمن وموعدها وسياج التنفيذ. */
export interface PushDeliveryAttempt {
  readonly companyId: string;
  readonly id: string;
  readonly subscriptionId: string;
  readonly subscriptionGeneration: number;
  readonly userId: string;
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly sourceEventId: string;
  readonly templateKey: string;
  readonly templateRevision: number;
  readonly locale: 'ar' | 'en';
  readonly safeParameters: readonly {
    readonly name: string;
    readonly type: 'text' | 'number';
    readonly value: string | number;
  }[];
  readonly status: string;
  readonly deadline: Date | null;
  readonly executionId: string | null;
  readonly sendingAt: Date | null;
}

/** لقطة الاشتراك وقت الإرسال: عدّاده ومفتاحه وأسراره، والوجهة بتتقرا هنا بس. */
export interface PushDeliverySubscription {
  readonly generation: number;
  readonly vapidKeyId: string;
  readonly revokedAt: Date | null;
  readonly endpoint: string | null;
  readonly p256dh: string | null;
  readonly auth: string | null;
  readonly deliveryToken: string | null;
}

/** المحاولة واشتراكها: كل ما يحتاجه الإرسال قبل أي طلب للخدمة. */
export interface PushDelivery {
  readonly attempt: PushDeliveryAttempt;
  readonly subscription: PushDeliverySubscription;
}

/** نتيجة تقديم واحدة؛ نسخة بنيوية من نتيجة القناة بلا جسم المزود. */
export type PushSubmission =
  | { readonly kind: 'accepted'; readonly httpStatus: number }
  | { readonly kind: 'expired' }
  | { readonly kind: 'refused'; readonly code: 'CAPABILITY_UNAVAILABLE' }
  | { readonly kind: 'gone'; readonly httpStatus: number }
  | {
      readonly kind: 'rejected';
      readonly code: 'PROVIDER_4XX' | 'PROVIDER_429';
      readonly httpStatus: number;
      readonly vapidRejected: boolean;
    }
  | {
      readonly kind: 'unknown';
      readonly code: 'PROVIDER_5XX' | 'NETWORK_UNKNOWN';
      readonly outcomeKnown: false;
      readonly httpStatus: number | null;
    };

/** قرار الإرسال: النتيجة النهائية، وأي سحب للاشتراك، وتشخيص رفض المفتاح. */
export interface PushDecision {
  readonly result: PushTerminalResult;
  readonly revoke: PushRevokeReason | null;
  readonly vapidRejected: boolean;
}

/** وجهة الإرسال: العنوان ومفتاح التوقيع ومفتاح المصادقة — نفس شكل طلب القناة. */
export interface PushSendTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/** طلب الإرسال: الوجهة والحمولة ومدة البقاء والأولوية والموضوع والموعد. */
export interface PushSendRequest {
  readonly target: PushSendTarget;
  readonly payload: string;
  readonly ttlSeconds: number;
  readonly urgency: 'high';
  readonly topic: string;
  readonly deadline: Date | null;
}

/**
 * يبني رفضًا محليًا: الفشل معروف والنتيجة معلومة وبلا سحب.
 *
 * @param code   سبب الرفض المحدود
 * @param status حالة المحاولة بعد الرفض
 * @param revoke سبب سحب الاشتراك لو الرفض بيطلب سحب
 * @returns قرار الرفض المحلي
 */
function localFailure(
  code: PushFailureCode,
  status: 'FAILED' | 'EXPIRED' = 'FAILED',
  revoke: PushRevokeReason | null = null,
): PushDecision {
  return {
    result: { status, failureCode: code, outcomeKnown: true, httpStatus: null },
    revoke,
    vapidRejected: false,
  };
}

/**
 * يقرر إن كانت المحاولة ممكنة تتسلّم محليًا، ويقول سبب المنع لو لأ.
 * القاعدة: الموعد اللي عدّى أو اشتراك مسحوب أو متغيّر أو مفتاح قديم معناها إن مفيش ولا طلب؛
 * الترتيب ثابت عشان السبب المسجّل هو الأسبق أثرًا، ومعرّف المفتاح null معناها إن مفيش مفتاح
 * نشوفه (الوضع المزيف) فمفيش مقارنة للمفتاح.
 *
 * @param delivery     المحاولة واشتراكها
 * @param currentKeyId معرّف مفتاح VAPID الحالي، أو null لما مفيش مفتاح
 * @param now          اللحظة الحالية
 * @returns null لو الإرسال مسموح، أو قرار المنع المحلي
 */
export function pushPreflight(
  delivery: PushDelivery,
  currentKeyId: string | null,
  now: Date,
): PushDecision | null {
  const { attempt, subscription } = delivery;
  if (attempt.deadline !== null && attempt.deadline.getTime() <= now.getTime())
    return localFailure('DEADLINE_EXPIRED', 'EXPIRED');
  if (
    subscription.revokedAt !== null ||
    subscription.endpoint === null ||
    subscription.p256dh === null ||
    subscription.auth === null ||
    subscription.deliveryToken === null
  )
    return localFailure('SUBSCRIPTION_REVOKED');
  if (subscription.generation !== attempt.subscriptionGeneration)
    return localFailure('SUBSCRIPTION_CHANGED');
  if (currentKeyId !== null && subscription.vapidKeyId !== currentKeyId)
    return localFailure('KEY_ROTATED', 'FAILED', 'KEY_ROTATED');
  return null;
}

/**
 * يحوّل دليل التقديم إلى قرار نهائي؛ عدم اليقين لا يسمح بإعادة الإرسال.
 * القاعدة: القبول يثبت قبول الخدمة بس، والاختفاء يسحب الاشتراك، والرفض من المفتاح يتشخّص وحده.
 *
 * @param submission نتيجة تقديم واحدة من القناة بلا جسم مزود
 * @returns القرار النهائي وأي سحب للاشتراك
 */
export function pushDecisionFromSubmission(submission: PushSubmission): PushDecision {
  if (submission.kind === 'accepted')
    return {
      result: {
        status: 'SENT',
        failureCode: null,
        outcomeKnown: true,
        httpStatus: submission.httpStatus,
      },
      revoke: null,
      vapidRejected: false,
    };
  if (submission.kind === 'expired') return localFailure('DEADLINE_EXPIRED', 'EXPIRED');
  if (submission.kind === 'refused') return localFailure('CONFIG_INVALID');
  if (submission.kind === 'gone')
    return {
      result: {
        status: 'FAILED',
        failureCode: 'SUBSCRIPTION_GONE',
        outcomeKnown: true,
        httpStatus: submission.httpStatus,
      },
      revoke: 'GONE',
      vapidRejected: false,
    };
  if (submission.kind === 'rejected')
    return {
      result: {
        status: 'FAILED',
        failureCode: submission.code,
        outcomeKnown: true,
        httpStatus: submission.httpStatus,
      },
      revoke: null,
      vapidRejected: submission.vapidRejected,
    };
  return {
    result: {
      status: 'FAILED',
      failureCode: submission.code,
      outcomeKnown: false,
      httpStatus: submission.httpStatus,
    },
    revoke: null,
    vapidRejected: false,
  };
}

/**
 * يبني رفضًا لوجهة بقت مش على قائمة المواقع المسموحة.
 * القاعدة: الوجهة دي ما بتوصلش لخدمة دفع مسموحة، فالاشتراك بقى بلا فايدة: بيتسحب وأسراره بتتمسح.
 *
 * @returns قرار الرفض مع سحب الاشتراك
 */
export function invalidEndpointDecision(): PushDecision {
  return {
    result: {
      status: 'FAILED',
      failureCode: 'SUBSCRIPTION_GONE',
      outcomeKnown: true,
      httpStatus: null,
    },
    revoke: 'GONE',
    vapidRejected: false,
  };
}

/**
 * يبني رفضًا محليًا معلومًا قبل أي طلب للخدمة.
 * القاعدة: انتهاء الموعد منتهية، والباقي فشل معروف من غير أي إرسال.
 *
 * @param code سبب الرفض المحدود
 * @returns قرار الرفض المحلي
 */
export function refusedDecision(
  code: 'PARAMETERS_INVALID' | 'ADMISSION_REFUSED' | 'DEADLINE_EXPIRED',
): PushDecision {
  return localFailure(code, code === 'DEADLINE_EXPIRED' ? 'EXPIRED' : 'FAILED');
}
