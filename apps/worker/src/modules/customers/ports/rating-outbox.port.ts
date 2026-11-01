/** الحدث المضاف إلى الـ outbox مع هوية الـ aggregate التي يقفل. */
export interface RatingOutboxEvent {
  readonly aggregateType: 'rating_request';
  readonly aggregateId: string;
  readonly eventType: 'RatingRequestReady';
  readonly payload: unknown;
}

/** تسجيل الحدث في الـ outbox، وهي كتابة تذهب مع معاملة المطالبة نفسها. */
export interface RatingOutboxPort<Transaction = unknown> {
  /**
   * يسجّل الحدث في الـ outbox داخل معاملة المطالبة، فما بيخرجش إشعار لطلب ما اتم.
   *
   * @param tx معاملة المطالبة
   * @param id معرف الحدث المولّد
   * @param event نوع الحدث وهوية الـ aggregate وحمولته
   * @returns اكتمال إضافة الصف
   */
  append(tx: Transaction, id: string, event: RatingOutboxEvent): Promise<void>;
}
