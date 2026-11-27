import type {
  Attempt,
  FailureCode,
  PhoneIdentity,
  TerminalResult,
} from '../domain/attempt-status.ts';

export interface ChannelPort {
  /** يقدّم الطلب مرة واحدة خارج المعاملات ويعيد نتيجة محدودة بلا جسم مزود.
   *
   * @param attempt لقطة الإذن والوجهة المؤقتة
   */
  send(attempt: Attempt): Promise<TerminalResult>;
}
export interface DestinationIdentity {
  /** يثبت أن الوجهة المخزنة تطابق هوية قناتها ومفتاحها قبل حيازة التنفيذ.
   *
   * @param phone الوجهة المؤقتة للهاتف أو البريد
   * @param identity الهوية المخزنة
   * @param attempt لقطة المحاولة؛ قوالب الترحيب بتفك المظروف منها قبل المطابقة
   */
  matches(phone: string, identity: PhoneIdentity, attempt?: Attempt): boolean;
}
export interface SendConfiguration {
  /** يرفض أي قالب غير معتمد أو معاملات حساسة قبل الإرسال.
   *
   * @param attempt لقطة القالب الثابتة
   */
  failure(attempt: Attempt): FailureCode | null;
  /** فحص اختياري داخل معاملة الحيازة للتحقق من سريان الوجهة أو المرجع في قاعدة البيانات.
   *
   * @param attempt لقطة المحاولة قبل التحويل إلى SENDING
   * @param scope   نطاق المعاملة الحالية لتشغيل القراءة تحت نفس القفل، إن وُجد
   */
  verify?(attempt: Attempt, scope?: unknown): Promise<boolean>;
  /** يحدد إن كانت المحاولة تحتاج فحص حداثة تحت قفل الصف قبل الحيازة.
   *
   * @param attempt لقطة المحاولة قبل المطالبة
   */
  shouldVerify?(attempt: Attempt): boolean;
}

/** مشتق رابط التقييم في الذاكرة وقت الإرسال فقط؛ الرابط لا يُخزَّن ولا يُسجَّل ولا يدخل outbox. */
export interface RatingTokenSender {
  /**
   * يشتق نص الرابط لطلب تقييم بإصدار المفتاح المحفوظ وقت المطالبة.
   *
   * @param identity الشركة وطلب التقييم اللذان يُشتق منهما الرابط
   * @param identity.companyId الشركة صاحبة الطلب
   * @param identity.ratingRequestId معرّف طلب التقييم
   * @param keyVersion إصدار مفتاح الاشتقاق المحفوظ في طلب الجاهزية
   * @returns نص الرابط، أو null لما الإصدار غير موجود في الحلقة فيفشل الإرسال مغلقاً
   */
  token(
    identity: { readonly companyId: string; readonly ratingRequestId: string },
    keyVersion: number,
  ): string | null;
}
