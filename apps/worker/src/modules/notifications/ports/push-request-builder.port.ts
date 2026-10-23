import type { PushRequest } from '@pospay/notifications';

import type { PushDecision, PushDelivery } from '../domain/push-delivery.ts';

/** الطلب جاهز للإرسال، أو الرفض المحلي اللي بيمنعه. */
export type PushBuild =
  | { readonly kind: 'ready'; readonly request: PushRequest }
  | { readonly kind: 'refused'; readonly decision: PushDecision };

export interface PushRequestBuilder {
  /** يبني طلب الدفع من المحاولة واشتراكها، أو يرفض محليًا بصفر طلبات.
   *
   * @param delivery المحاولة واشتراكها
   * @param now      اللحظة الحالية
   */
  build(delivery: PushDelivery, now: Date): PushBuild;
}
