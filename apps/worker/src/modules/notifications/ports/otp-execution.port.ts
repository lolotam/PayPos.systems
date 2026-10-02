/** بيانات انتظار بلا هاتف أو كود أو جلسة، بموعدين ثابتين. */
export interface OtpPending {
  readonly id: string;
  readonly challengeId: string;
  readonly recipientHash: Uint8Array;
  readonly locale: 'ar' | 'en';
  readonly providerTemplateName: string | null;
  readonly status: string;
  readonly sendDeadline: Date;
  readonly preparationDeadline: Date;
}

/** نتيجة مزود محدودة؛ معرّف الرسالة نفسه لا يدخل السجل. */
export interface OtpResult {
  readonly status: 'SENT' | 'FAILED' | 'EXPIRED' | 'SUPPRESSED';
  readonly failureCode:
    | 'PROVIDER_ACCEPTED'
    | 'PROVIDER_REJECTED'
    | 'PROVIDER_UNKNOWN'
    | 'ADMISSION_REFUSED'
    | 'DESTINATION_INVALID'
    | 'CHALLENGE_INVALID'
    | 'CONFIG_INVALID'
    | 'PREPARATION_WINDOW_ENDED';
  readonly outcomeKnown: boolean;
  readonly providerMessageDigest?: Uint8Array;
}

/** صلاحية تنفيذ محصورة، لا دليل مستخدمين ولا إصدار جلسات ولا معاملات خام. */
export interface OtpExecution {
  /** القراءة القصيرة تعيد الموعد الثابت دون أي مادة حساسة.
   *
   * @param challengeId معرف التحدي الثابت
   * @param attemptId معرف المحاولة الثابت
   */
  pending(challengeId: string, attemptId: string): Promise<OtpPending | null>;
  /** فحص مقفول أخير يفصل timeout عن release المتزامن.
   *
   * @param challengeId معرف التحدي الثابت
   * @param attemptId معرف المحاولة الثابت
   */
  timeout(challengeId: string, attemptId: string): Promise<string | null>;
  /** لا تسمح نتيجة commit غير مؤكدة باستعادة تصريح الإرسال.
   *
   * @param challengeId معرف التحدي الثابت
   * @param attemptId معرف المحاولة الثابت
   * @param executionId fence التنفيذ المؤكد
   */
  claim(challengeId: string, attemptId: string, executionId: string): Promise<boolean>;
  /** البيانات تظهر في الذاكرة فقط بعد fence مؤكد وتطابق الهاتف الحالي.
   *
   * @param challengeId معرف التحدي الثابت
   * @param attemptId معرف المحاولة الثابت
   * @param executionId fence التنفيذ المؤكد
   */
  materialize(
    challengeId: string,
    attemptId: string,
    executionId: string,
  ): Promise<{ phone: string; code: string; deadline: Date } | null>;
  /** يعيد تسجيل النتيجة نفسها دون استعادة الإرسال.
   *
   * @param challengeId معرف التحدي الثابت
   * @param attemptId معرف المحاولة الثابت
   * @param executionId fence التنفيذ المؤكد
   * @param result نتيجة محدودة بلا مادة حساسة
   */
  finish(
    challengeId: string,
    attemptId: string,
    executionId: string | null,
    result: OtpResult,
  ): Promise<void>;
  /** يفحص الدور والصلاحيات دون ربطه باستعداد الخدمة العادي. */
  readiness(): Promise<void>;
  /** إغلاق الموارد المحصورة وقت الإيقاف. */
  close(): Promise<void>;
}

/** استعداد قدرة الدخول مستقل عن استعداد الخدمة. */
export interface OtpWorkerCapability {
  /** لقطة الإعداد والصحة الأخيرة أثناء الانتظار فقط؛ لا تنفذ I/O ولا تمنح إذن إرسال. */
  available(): boolean;
  /** يعاد قبل claim والتكوين وHTTP لأن الطابور قد يحتوي عملاً قديماً. */
  ready(): Promise<boolean>;
}

/** مؤقت خارج المعاملة لا يعيد بدء نافذة التجهيز. */
export interface OtpWait {
  /** الانتظار خارج كل connection أو lock، بلا إعادة بدء المهلة.
   *
   * @param milliseconds مدة الانتظار داخل المهلة الثابتة
   */
  pause(milliseconds: number): Promise<void>;
}

/** تشخيص داخلي محدود لا يحمل أرقاماً أو اعتماداً أو رد المزود. */
export interface OtpDiagnostics {
  /** يسجل سبب التوقف المحدود دون إعطاء العميل معلومة عن الهوية.
   *
   * @param outcome نتيجة تشغيلية من القائمة المحدودة فقط
   */
  record(
    outcome:
      | 'CAPABILITY_LOST'
      | 'WORKER_ERROR'
      | 'MISSING_OR_TERMINAL'
      | 'CLAIM_NOT_ACKNOWLEDGED'
      | 'PREPARATION_TIMEOUT_PERSISTENCE_FAILED',
  ): void;
}

/** قناة خاصة بالتكوين المؤقت المعتمد للمصادقة فقط. */
export interface OtpChannel {
  /** يفحص locale والاسم المعتمد قبل حجز السعة ولا يولّد code.
   *
   * @param attempt السجل الخالي من الاعتماد
   */
  valid(attempt: OtpPending): boolean;
  /** يقدم طلباً واحداً بمادة مؤقتة ثم يعيد نتيجة خالية من الوجهة والاعتماد.
   *
   * @param attempt السجل الخالي من الاعتماد
   * @param material مادة مؤقتة لا تُخزن
   */
  send(attempt: OtpPending, material: OtpMaterial): Promise<OtpResult>;
}

/** مادة عابرة في الذاكرة لطلب HTTPS واحد بعد fence معتمد. */
export interface OtpMaterial {
  readonly phone: string;
  readonly code: string;
  readonly deadline: Date;
}
