import type { PushSendRequest, PushSubmission } from '../domain/push-delivery.ts';

export interface PushChannelPort {
  /** بيبعت طلب واحد مرة واحدة بره أي معاملة، وبيرجّع دليل التقديم المحدود.
   *
   * @param request الطلب جاهز للإرسال
   */
  send(request: PushSendRequest): Promise<PushSubmission>;
}
