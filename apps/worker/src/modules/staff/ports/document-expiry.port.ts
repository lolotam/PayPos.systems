/** وثيقة حالية مرشحة لتنبيه انتهاء كما تقرؤها الوظيفة، بلا مفتاح ملف أو محتوى. */
export interface DocumentExpiryCandidate {
  readonly documentId: string;
  readonly employeeId: string;
  readonly businessId: string;
  readonly typeCode: string;
  /** تاريخ الانتهاء بصيغة YYYY-MM-DD. */
  readonly expiresOn: string;
  /** أيام تنبيه النوع الحالية وقت الفحص. */
  readonly alertDays: number;
}

/** موضع الصفحة التالية بترتيب ثابت (expires_on ثم id) حتى لا تتكرر وثيقة أو تسقط بين الصفحات. */
export interface DocumentExpiryCursor {
  readonly expiresOn: string;
  readonly documentId: string;
}

/** ما فعلته دورة واحدة لشركة واحدة؛ يكفي للاختبار ولا يحمل بيانات موظف. */
export interface DocumentExpiryRun {
  notified: number;
}

/** حدود المعاملات داخل شركة واحدة فقط؛ لا قراءة عابرة للشركات. */
export interface DocumentExpiryTransactions {
  /**
   * أنشطة الشركة التي لها وثائق حالية بتواريخ انتهاء؛ لكل نشاط منطقة زمنية خاصة ليحسب يومه.
   *
   * @param companyId الشركة المجدولة
   * @returns معرّفات الأنشطة المرشحة
   */
  businesses(companyId: string): Promise<readonly string[]>;
  /**
   * منطقة النشاط الزمنية عبر قراءة tenancy المسجلة، أو الافتراضية إن غابت.
   *
   * @param companyId الشركة المجدولة
   * @param businessId النشاط
   * @returns منطقة IANA المستخدمة لحساب اليوم المحلي
   */
  timeZone(companyId: string, businessId: string): Promise<string>;
  /**
   * صفحة الوثائق الحالية الداخلة نافذة التنبيه وغير المُشعر بها بعد؛ قراءة بلا قفل.
   *
   * @param companyId الشركة المجدولة
   * @param businessId النشاط
   * @param timeZone منطقة النشاط المستخدمة لحساب اليوم داخل SQL
   * @param now لحظة الـ Clock المحقونة
   * @param after موضع الصفحة السابقة
   * @param limit حجم الصفحة
   * @returns المرشحون مرتبون بتاريخ الانتهاء
   */
  candidates(
    companyId: string,
    businessId: string,
    timeZone: string,
    now: Date,
    after: DocumentExpiryCursor | null,
    limit: number,
  ): Promise<readonly DocumentExpiryCandidate[]>;
  /**
   * يسجل إشعار الوثيقة مرة واحدة للتاريخ ويثبت التدقيق والحدث في نفس المعاملة.
   *
   * @param companyId الشركة المجدولة
   * @param candidate الوثيقة المرشحة
   * @param today يوم النشاط المحلي
   * @param at لحظة الإشعار من الـ Clock
   * @returns true لو سُجل الآن، false لو كان مسجلاً من قبل
   */
  notify(
    companyId: string,
    candidate: DocumentExpiryCandidate,
    today: string,
    at: Date,
  ): Promise<boolean>;
}
