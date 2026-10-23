/** وجهة الدفع: عنوان نقطة الدفع ومفتاح التوقيع ومفتاح المصادقة بتوع المتصفح. */
export interface PushTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/** طلب دفع واحد: الوجهة والحمولة ومدة البقاء والأولوية والموضوع وموعد انتهاء الطلب. */
export interface PushRequest {
  readonly target: PushTarget;
  readonly payload: string;
  readonly ttlSeconds: number;
  readonly urgency: 'high';
  readonly topic: string;
  readonly deadline: Date | null;
}

/**
 * نتيجة محاولة دفع واحدة.
 * القاعدة: النتيجة فيها رمز الحالة وسبب الرفض بس؛ جسم المزود ولا عنوانه ولا مفاتيحه ما بتوصلش فيها أبداً.
 */
export type PushResult =
  | { readonly kind: 'accepted'; readonly httpStatus: number }
  | { readonly kind: 'expired' }
  | { readonly kind: 'refused'; readonly code: 'CAPABILITY_UNAVAILABLE' }
  | { readonly kind: 'gone'; readonly httpStatus: 404 | 410 }
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

/** قناة الدفع: طلب واحد من غير إعادة محاولة، والنتيجة مفيهاش جسم المزود. */
export interface PushChannel {
  /** بيقدّم طلب دفع واحد ويعيد القبول أو الرفض أو عدم اليقين بدون جسم المزود ولا إعادة محاولة. */
  send(request: PushRequest): Promise<PushResult>;
}
