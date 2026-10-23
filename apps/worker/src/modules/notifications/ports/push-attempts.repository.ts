import type {
  PushAttemptDecision,
  PushAttemptInput,
  PushSubscription,
} from '../domain/push-attempt.ts';

/** تخزين محاولات الدفع: اشتراكات المستخدم الحيّة، وكتابة المحاولة مع إذن الإرسال في نفس المعاملة. */
export interface PushAttemptsRepository {
  /**
   * يرجع اشتراكات المستخدم الحيّة في الشركة دي، الأقدم الأول.
   * القاعدة: الطلب بياخد كل اشتراك حيّ للموظف (WP-Q2)، والاشتراك المسحوب ما بيترجعش أبداً.
   *
   * @param userId المستخدم المقصود
   * @returns الاشتراكات الحيّة مرتبة بالأقدم الأول
   */
  liveSubscriptions(userId: string): Promise<readonly PushSubscription[]>;

  /**
   * يكتب محاولة الدفع، ومعها حدث الإذن لو المحاولة معلّقة، في نفس معاملة المستهلك.
   * القاعدة: المحاولة المنتهية بتتسجل منتهية من غير حدث إذن، والمكررة بتترفض بصمت عشان ما يتكررش الإرسال.
   *
   * @param input     سياق المحاولة والاشتراك المقصود
   * @param decision  حالة المحاولة لحظة الكتابة
   * @param id        هوية المحاولة
   * @param eventId   هوية حدث الإذن
   * @param now       وقت الكتابة
   * @returns هل أُنشئ صف جديد
   */
  insert(
    input: PushAttemptInput,
    decision: PushAttemptDecision,
    id: string,
    eventId: string,
    now: Date,
  ): Promise<boolean>;
}
