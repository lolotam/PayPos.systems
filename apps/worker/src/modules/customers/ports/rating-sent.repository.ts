/** تخزين انتقال طلب التقييم من SENDING إلى SENT على معاملة المستهلك نفسها. */
export interface RatingSentRepository<Transaction> {
  /**
   * يسجل أن المزود قبل رسالة طلب التقييم: SENDING إلى SENT مع وقت القبول، والمحاولة المتكررة أو طلب بحالة أخرى لا تغيّر شيئاً.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة صاحبة الطلب
   * @param readyEventId معرّف حدث جاهزية التقييم الذي ربطته المطالبة بالطلب
   * @param sentAt لحظة قبول المزود كما سجلتها الإشعارات
   * @returns true لو الصف انتقل فعلاً الآن، false لو لا يوجد طلب مطابق في SENDING
   */
  markSent(
    tx: Transaction,
    companyId: string,
    readyEventId: string,
    sentAt: Date,
  ): Promise<boolean>;
}
