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
   */
  matches(phone: string, identity: PhoneIdentity): boolean;
}
export interface SendConfiguration {
  /** يرفض أي قالب غير معتمد أو معاملات حساسة قبل الإرسال.
   *
   * @param attempt لقطة القالب الثابتة
   */
  failure(attempt: Attempt): FailureCode | null;
}
