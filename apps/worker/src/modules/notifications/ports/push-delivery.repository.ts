import type { PushDecision, PushDelivery } from '../domain/push-delivery.ts';

export interface PushDeliveryRepository {
  /** يحمل المحاولة المعلّقة واشتراكها تحت RLS؛ غير المعلّقة لا تعود للعمل.
   *
   * @param companyId الشركة من المهمة
   * @param attemptId المحاولة من المهمة
   */
  pending(companyId: string, attemptId: string): Promise<PushDelivery | null>;
  /** يمنح إذن الإرسال فقط بعد رد COMMIT ناجح، ولا يعيد حيازة التنفيذ.
   *
   * @param delivery المحاولة المراد حيازتها
   * @param executionId معرّف السياج
   * @param now وقت القرار
   */
  claim(delivery: PushDelivery, executionId: string, now: Date): Promise<boolean>;
  /** يسجل رفضًا محليًا مع حدث النتيجة وسحب الاشتراك في معاملة واحدة.
   *
   * @param delivery المحاولة المعلّقة
   * @param decision القرار المحلي
   * @param eventId معرّف الحدث
   * @param now وقت النتيجة
   */
  finishPending(
    delivery: PushDelivery,
    decision: PushDecision,
    eventId: string,
    now: Date,
  ): Promise<boolean>;
  /** يسجل النتيجة تحت سياج SENDING والتنفيذ نفسه فلا ينتج حدثًا ثانيًا.
   *
   * @param delivery المحاولة المحجوزة
   * @param decision قرار المزود
   * @param eventId معرّف الحدث
   * @param now وقت النتيجة
   */
  finish(
    delivery: PushDelivery,
    decision: PushDecision,
    eventId: string,
    now: Date,
  ): Promise<boolean>;
}
