/** الكتابة الشخصية تُقيّد بالشركة والمستخدم حتى مع اشتراك المستخدمين في الشركة. */
export interface InboxActor {
  readonly companyId: string;
  readonly userId: string;
}

/** إقرار القراءة يغيّر الوقت مرة واحدة فقط. */
export interface InAppRepository {
  /**
   * يقرّ الرسالة إن كانت للمستخدم، والصف الغائب أو الغريب يظل no-op.
   *
   * @param actor الشركة والمستخدم المتحقق منهما
   * @param id الإشعار المطلوب
   * @param now وقت الإقرار الأول
   */
  markRead(actor: InboxActor, id: string, now: Date): Promise<void>;
  /**
   * يقرّ غير المقروء للمستخدم فقط دون تغيير أوقات الإقرار السابقة.
   *
   * @param actor الشركة والمستخدم المتحقق منهما
   * @param now وقت الإقرار الأول
   */
  markAllRead(actor: InboxActor, now: Date): Promise<void>;
}
