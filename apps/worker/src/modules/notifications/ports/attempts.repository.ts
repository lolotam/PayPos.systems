import type {
  Attempt,
  AuthorizationDecision,
  NotificationInput,
  TerminalResult,
} from '../domain/attempt-status.ts';

export interface AuthorizationRepository {
  /** يأخذ قفل الهاتف العام على معاملة المستهلك نفسها قبل المنع والإدراج.
   *
   * @param hash هوية الهاتف
   */
  lock(hash: Uint8Array): Promise<void>;
  /** الإدراج الفائز وحده يكتب الإذن أو النتيجة؛ التعارض لا يعيد إرسالًا.
   *
   * @param input لقطة طلب المصدر
   * @param decision الحالة الأولية
   * @param id معرّف المحاولة
   * @param eventId معرّف حدث الإذن أو الفشل
   * @param now وقت القرار
   */
  insert(
    input: NotificationInput,
    decision: AuthorizationDecision,
    id: string,
    eventId: string,
    now: Date,
  ): Promise<boolean>;
}
export interface AttemptsRepository {
  /** يحمل المحاولة المعلقة تحت RLS؛ الحالات المحجوزة والنهائية لا تعود للعمل.
   *
   * @param companyId الشركة من المهمة
   * @param attemptId المحاولة من المهمة
   */
  pending(companyId: string, attemptId: string): Promise<Attempt | null>;
  /** يمنح إذن الإرسال فقط بعد رد COMMIT الناجح، ولا يعيد حيازة التنفيذ.
   *
   * @param attempt المحاولة المراد حيازتها
   * @param executionId معرّف السياج
   * @param now وقت القرار
   */
  claim(attempt: Attempt, executionId: string, now: Date): Promise<boolean>;
  /** يسجل رفضًا قبل الحيازة مع مسح الوجهة وحدث النتيجة في معاملة واحدة.
   *
   * @param attempt المحاولة المعلقة
   * @param result النتيجة المحلية
   * @param eventId معرّف الحدث
   * @param now وقت النتيجة
   */
  finishPending(
    attempt: Attempt,
    result: TerminalResult,
    eventId: string,
    now: Date,
  ): Promise<boolean>;
  /** يسجل النتيجة تحت سياج SENDING والتنفيذ نفسه فلا ينتج حدثًا ثانيًا.
   *
   * @param attempt المحاولة المحجوزة
   * @param result نتيجة المزود
   * @param eventId معرّف الحدث
   * @param now وقت النتيجة
   */
  finish(attempt: Attempt, result: TerminalResult, eventId: string, now: Date): Promise<boolean>;
  /** يمسح وجهة SENDING القديم بعد توقف التنفيذ، ويترك الهوية والحالة مع أثر تدقيق.
   *
   * @param input شركة ومحاولة وتنفيذ معلومين وتأكيد التصريف
   * @param auditId معرّف سجل التدقيق
   * @param now وقت المسح
   */
  clearAbandoned(input: CleanupInput, auditId: string, now: Date): Promise<boolean>;
}
export interface CleanupInput {
  readonly companyId: string;
  readonly attemptId: string;
  readonly executionId: string;
  readonly executionStopped: boolean;
  readonly operatorId: string;
}
