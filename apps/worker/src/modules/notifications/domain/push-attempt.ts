/** اشتراك حيّ وقت التفويض: هويته ولغته وعدّاده — ولا سر من أسرار الاشتراك. */
export interface PushSubscription {
  readonly id: string;
  readonly locale: 'ar' | 'en';
  readonly generation: number;
}

/** سياق محاولة الدفع: من أنا وإيه المصدر والقالب الآمن واشتراك واحد مقصود. */
export interface PushAttemptInput {
  readonly companyId: string;
  readonly sourceEventId: string;
  readonly userId: string;
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly templateKey: string;
  readonly templateRevision: number;
  readonly safeParameters: readonly {
    name: string;
    type: 'text' | 'number';
    value: string | number;
  }[];
  readonly deadline: Date | null;
  readonly subscription: PushSubscription;
}

/** حالة المحاولة لحظة التفويض: معلّقة للإرسال، أو منتهية لأن الموعد عدّى. */
export type PushAttemptDecision =
  | { readonly status: 'PENDING' }
  | { readonly status: 'EXPIRED'; readonly failureCode: 'DEADLINE_EXPIRED' };

/**
 * يقرر حالة محاولة الدفع لحظة التفويض.
 * القاعدة: الموعد اللي عدّى أو جه في نفس اللحظة معناها إن الإرسال مش هيحصل، فالمحاولة منتهية؛
 * مفيش موعد أو موعد بعد الآن معناها محاولة معلّقة تنتظر إذن الإرسال.
 *
 * @param deadline الموعد المطلق للإرسال، أو null لو مفيش موعد
 * @param now      وقت القرار
 * @returns حالة المحاولة: PENDING أو EXPIRED مع سببها
 */
export function pushAttemptDecision(deadline: Date | null, now: Date): PushAttemptDecision {
  if (deadline !== null && deadline.getTime() <= now.getTime())
    return { status: 'EXPIRED', failureCode: 'DEADLINE_EXPIRED' };
  return { status: 'PENDING' };
}
