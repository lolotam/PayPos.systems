export type LeaveHistoryReportFailure =
  | 'LEAVE_HISTORY_REPORT_FAILED'
  | 'LEAVE_HISTORY_REPORT_TOO_LARGE';
export type LeaveHistoryReportStatus = 'pending' | 'ready' | 'failed';

/** رفض الحجم آمن وثابت؛ تفاصيل الاستعلام لا تخرج إلى سجلات المهام. */
export class LeaveHistoryReportTooLargeError extends Error {
  /** يبني الرفض برمز ثابت بلا بيانات. */
  constructor() {
    super('LEAVE_HISTORY_REPORT_TOO_LARGE');
    this.name = 'LeaveHistoryReportTooLargeError';
  }
}

/** رفض الموعد آمن وثابت؛ إعادة الحساب بعد الموعد لا تغير النتيجة. */
export class LeaveHistoryReportDeadlineError extends Error {
  /** يبني الرفض برمز ثابت بلا بيانات. */
  constructor() {
    super('LEAVE_HISTORY_REPORT_DEADLINE');
    this.name = 'LeaveHistoryReportDeadlineError';
  }
}

/** المدخل المخزن غير صالح؛ لا رسالة تحقق ولا محتوى محفوظ يخرج من المحول. */
export class LeaveHistoryReportInputError extends Error {
  /** يبني الرفض برمز ثابت بلا بيانات. */
  constructor() {
    super('LEAVE_HISTORY_REPORT_INPUT_INVALID');
    this.name = 'LeaveHistoryReportInputError';
  }
}

/** معاملات التقرير معزولة عن المهمة حتى تبقى أخطاء السائق داخل المحول. */
export interface LeaveHistoryReportTransactions {
  /**
   * يبني النتيجة تحت قفل الصف المعلق أو يرفض باسم آمن.
   *
   * @param companyId الشركة المالكة للتقرير
   * @param reportId التقرير المطلوب حسابه
   * @returns اكتمال البناء أو تجاهل تقرير غير معلق
   */
  build(companyId: string, reportId: string): Promise<void>;
  /**
   * يفشل الصف المعلق فقط حتى لا يمحو نتيجة سابقة.
   *
   * @param companyId الشركة المالكة للتقرير
   * @param reportId التقرير المطلوب إنهاؤه
   * @param code رمز الفشل الآمن المعروض للمستخدم
   * @returns اكتمال التحديث الشرطي
   */
  fail(companyId: string, reportId: string, code: LeaveHistoryReportFailure): Promise<void>;
  /**
   * يقرأ الحالة بعد رد commit مجهول ليقرر المستهلك بلا تخمين.
   *
   * @param companyId الشركة المالكة للتقرير
   * @param reportId التقرير الذي فقد رد التزامه
   * @returns الحالة الحالية أو غياب التقرير
   */
  readStatus(companyId: string, reportId: string): Promise<LeaveHistoryReportStatus | null>;

  /**
   * يقرأ منشئ التقرير ليحمل سجل الفشل معرّف المستخدم؛ لا يؤثر في قرار البناء.
   *
   * @param companyId الشركة المالكة للتقرير
   * @param reportId التقرير الذي فشل بناؤه
   * @returns معرّف المستخدم المنشئ أو غياب التقرير
   */
  readCreator(companyId: string, reportId: string): Promise<string | null>;
}

/** سياق التشخيص: معرّفات الارتباط ورمز ثابت فقط، دون رسالة السائق ولا نص الاستعلام. */
export interface LeaveHistoryReportFailureContext {
  companyId: string;
  reportId: string;
  createdBy: string | null;
  code: string;
}

/** تشخيص آمن لقرار البناء؛ لا يحمل إلا رمزًا ثابتًا ومعرّفات الارتباط. */
export interface LeaveHistoryReportDiagnostics {
  /**
   * يسجل رمز القرار الآمن فقط دون رسالة السائق أو نص الاستعلام.
   *
   * @param context الشركة والتقرير والمستخدم المنشئ ورمز ثابت يصف الفشل الدائم أو إعادة المحاولة
   * @returns تسجيل التشخيص المختصر
   */
  failed(context: LeaveHistoryReportFailureContext): void;
}

/** حذف احتفاظ محدود الدفعات حتى لا تحتجز المهمة تقريرًا كبيرًا طويلًا. */
export interface LeaveHistoryReportCleanupTransactions {
  /**
   * يحذف دفعة واحدة من التقارير المنتهية غير المقفلة.
   *
   * @param companyId الشركة صاحبة الجدول الدوري
   * @returns عدد التقارير المحذوفة ليقرر المستهلك الاستمرار أو التوقف
   */
  deleteExpired(companyId: string): Promise<number>;
}
