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

/**
 * الوثيقة كما قُرئت تحت القفل: حقائق الإشعار وأسماء الموظفة والفرع ونوع المستند.
 * الصفحة بلا قفل ما بتوصلش للاسماء دي؛ القفل هو اللي يثبتها قبل الإرفاق.
 */
export interface LockedDocumentExpiry {
  readonly documentId: string;
  readonly employeeId: string;
  readonly businessId: string;
  readonly typeCode: string;
  /** تاريخ الانتهاء بصيغة YYYY-MM-DD. */
  readonly expiresOn: string;
  /** أيام تنبيه النوع الحالية وقت الفحص. */
  readonly alertDays: number;
  /** الفرع الأساسي للموظفة؛ مرشحو دور «مدير الفرع» (AL-Q7). */
  readonly primaryBranchId: string;
  /** اسم الموظفة العربي أو null. */
  readonly employeeNameAr: string | null;
  /** اسم الموظفة الإنجليزي. */
  readonly employeeNameEn: string;
  /** اسم نوع المستند العربي أو null. */
  readonly typeNameAr: string | null;
  /** اسم نوع المستند الإنجليزي. */
  readonly typeNameEn: string;
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
   * @param after آخر نشاط في الصفحة السابقة أو null للبداية
   * @param limit حجم الصفحة
   * @returns صفحة معرّفات الأنشطة المرشحة مرتبة تصاعدياً
   */
  businesses(companyId: string, after: string | null, limit: number): Promise<readonly string[]>;
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
   * الوثيقة بلا إرفاق مستلمين لسه مرشحة (علامة الإرفاق NULL)، وكذلك الوثيقة اللي لسه ما اتعملش لها إشعار.
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
   * يعيد فحص الوثيقة والنوع تحت قفل، ثم يسجل الإشعار والتدقيق والحدث، ويفرز مستلميه مرة واحدة.
   * الترميز: صف واحد لكل وثيقة وتاريخ انتهاء؛ المستلمون بيترفقوا مرة واحدة، وعلامتهم ما بترجعش لـ NULL.
   *
   * @param companyId الشركة المجدولة
   * @param candidate الوثيقة المرشحة
   * @param today يوم النشاط المحلي
   * @param at لحظة الإشعار من الـ Clock
   * @returns true لو اتسجل الإشعار أو اتفرق مستلموه، false لو سبق أو ما بقىش مستحق
   */
  notify(
    companyId: string,
    candidate: DocumentExpiryCandidate,
    today: string,
    at: Date,
  ): Promise<boolean>;
}
