import type { ServiceImportNormalizedRow, ServiceImportRowIssue } from '../domain/service-import-row.ts';
import type { ServiceImportFileFacts } from '../domain/service-import-file.ts';

/** تصنيف مفتوح في النشاط كما يقرأه القالب والمعاينة بنفس الاستعلام الواحد. */
export interface ServiceImportCategoryOption {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
}

/** مطابقة دفعة واحدة لنصوص التصنيفات المطلقة (A-12): نص مطلق ↔ تصنيفه المفتوح المحلول. */
export interface ServiceImportCategoryMatch {
  readonly label: string;
  readonly id: string;
  readonly nameEn: string;
}

/** مدخلات حفظ المعاينة الجاهزة: صفوف مطبّعة غير قابلة للتغيير وأخطاء مسمّاة، بلا كتابة أي خدمة. */
export interface SaveServiceImportPreviewInput {
  readonly id: string;
  readonly businessId: string;
  readonly fileId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly rowCount: number;
  readonly rows: readonly ServiceImportNormalizedRow[];
  readonly errors: readonly ServiceImportRowIssue[];
}

/** معاينة محفوظة كما يقرأها مسار الصفوف والحالة داخل الشركة والنشاط ومنشئها فقط. */
export interface StoredServiceImportPreview {
  readonly id: string;
  readonly business_id: string;
  readonly created_by: string;
  readonly row_count: number;
  readonly rows: readonly ServiceImportNormalizedRow[];
}

/** معاينة مقفلة كما يقرأها مسار القبول: حالتها وانتهاءها وأخطاؤها، بلا صفوف. */
export interface StoredServiceImportCommitPreview {
  readonly id: string;
  readonly business_id: string;
  readonly created_by: string;
  readonly status: 'ready' | 'commit_requested' | 'committed' | 'failed';
  readonly expires_at: string;
  readonly error_count: number;
  readonly errors: readonly ServiceImportRowIssue[];
}

/** نطاق المعاملة: قراءة المعاينة المقفلة وتسجيل طلب التثبيت وحدثه. */
export interface ServiceImportCommitScope {
  /**
   * يقرأ المعاينة المقفلة FOR UPDATE للتحقق من الانتهاء والاستهلاك مرة واحدة.
   *
   * @param previewId معرّف المعاينة
   * @returns المعاينة أو null للمجهول أو الخارج عن النشاط
   */
  load(previewId: string): Promise<StoredServiceImportCommitPreview | null>;
  /**
   * ينقل المعاينة إلى حالة الطلب المقبول ويسجّل حدث التثبيت داخل المعاملة نفسها؛ لا ينشئ خدمة في الـ API.
   *
   * @param previewId معرّف المعاينة المقفلة
   * @param requestedAt لحظة قبول الطلب من الساعة المحقونة
   */
  request(previewId: string, requestedAt: string): Promise<void>;
}

/** نطاق معاملة المعاينة: حقائق الملف، تصنيفات النشاط، مطابقة التصنيفات بالدفعة، مطابقة الأسماء، والحفظ. */
export interface ServiceImportPreviewScope {
  /**
   * يقرأ حقائق الملف الموثّق داخل الشركة، ويرجّع null للمجهول أو الخارج عن الملكية.
   *
   * @param fileId معرّف الملف المطلق من الطلب
   * @returns حقائق الملف أو null
   */
  fileFacts(fileId: string): Promise<ServiceImportFileFacts | null>;
  /**
   * يقرأ تصنيفات النشاط المفتوحة بأسمائها، الاستعلام الواحد المشترك بين القالب والمعاينة (FR-004).
   *
   * @param businessId النشاط المستهدف
   * @returns التصنيفات المفتوحة بترتيب أسمائها الإنجليزية
   */
  categories(businessId: string): Promise<readonly ServiceImportCategoryOption[]>;
  /**
   * يسجّل دخولًا تدقيقيًا على الوصول للملف الخاص داخل المعاملة الجارية (CLAUDE.md §8).
   *
   * @param fileId معرّف الملف المقروء
   */
  auditFileAccess(fileId: string): Promise<void>;
  /**
   * يطابق نصوص التصنيفات المطلّقة دفعة واحدة على تصنيفات النشاط المفتوحة في Postgres (A-12).
   *
   * @param labels نصوص خلايا التصنيف بعد التشذيب فقط، بلا تكرار
   * @returns المطابقات المحلولة لكل نص قانوني
   */
  matchCategories(labels: readonly string[]): Promise<readonly ServiceImportCategoryMatch[]>;
  /**
   * يقارن أسماء الصفوف المطلّقة داخل PostgreSQL بتعبير الطي الواحد على الطرفين: التكرار داخل
   * الملف والوجود في النشاط (المفتوحة والمقفولة معاً) قرار واحد من قاعدة البيانات (FR-007،
   * HIGH مراجعة 1186) بلا اشتقاق مفتاح في JS.
   *
   * @param labels أسماء الصفوف المطلّقة بعد تشذيب المحوّل، بترتيب الصفوف ومع تكرارها
   * @returns حالة كل اسم بترتيب الإدخال نفسه
   */
  matchServiceNames(
    labels: readonly string[],
  ): Promise<readonly { readonly duplicate_in_file: boolean; readonly exists: boolean }[]>;
  /**
   * يحفظ المعاينة الجاهزة وصفوفها وأخطاءها في كتابة مستأجر واحدة دون كتابة أي خدمة.
   *
   * @param input بيانات المعاينة
   * @returns اكتمال الحفظ
   */
  save(input: SaveServiceImportPreviewInput): Promise<void>;
}

/** حدود معاملات المعاينة تفصل قراءة التخزين عن قاعدة البيانات وتسمح باختبار التنسيق دون قاعدة. */
export interface ServiceImportTransactions {
  /**
   * يدخل الشركة المتحقق منها لقراءة حقائق الملف أو تصنيفات النشاط قبل أي قراءة من التخزين.
   *
   * @param actor الهوية المتحقق منها
   * @param actor.companyId الشركة المستهدفة
   * @param actor.userId المستخدم المستورد
   * @param work عمل نطاق المعاينة
   * @returns ناتج العمل
   */
  runFacts<T>(
    actor: { companyId: string; userId: string },
    work: (
      scope: Pick<ServiceImportPreviewScope, 'fileFacts' | 'categories' | 'auditFileAccess'>,
    ) => Promise<T>,
  ): Promise<T>;
  /**
   * يدخل الشركة مرة واحدة لمطابقة التصنيفات والأسماء وحفظ المعاينة في نفس المعاملة.
   *
   * @param actor              الهوية المتحقق منها
   * @param actor.companyId    الشركة المستهدفة
   * @param actor.userId       المستخدم المستورد
   * @param actor.businessId   النشاط الذي ثُبّتت حقائق ملفه في معاملة الحقائق
   * @param work               عمل المطابقة والحفظ
   * @returns ناتج العمل
   */
  runMatchAndSave<T>(
    actor: { companyId: string; userId: string; businessId: string },
    work: (
      scope: Pick<
        ServiceImportPreviewScope,
        'matchCategories' | 'matchServiceNames' | 'save'
      >,
    ) => Promise<T>,
  ): Promise<T>;
  /**
   * يدخل الشركة مرة واحدة فيقفل المعاينة ويضم قراءة الطلب وتحديث حالته والحدث وردّه المخزّن مع مفتاح idempotency.
   *
   * @param actor              الهوية المتحقق منها
   * @param actor.companyId    الشركة المستهدفة
   * @param actor.userId       المستخدم المستورد
   * @param actor.businessId   النشاط الذي تنتمي إليه المعاينة
   * @param actor.previewId    المعاينة التي يثبت ملكيتها قبل إعادة الرد
   * @param actor.key          مفتاح idempotency
   * @param actor.fingerprint  بصمة الطلب (معرف المعاينة)
   * @param work               عملية القبول
   * @returns قبول الطلب بمعرف المعاينة، حتى عند إعادة الرد القديم
   */
  runCommit(
    actor: {
      companyId: string;
      userId: string;
      businessId: string;
      previewId: string;
      key: string;
      fingerprint: string;
    },
    work: (scope: ServiceImportCommitScope) => Promise<{ preview_id: string }>,
  ): Promise<{ preview_id: string }>;
}

/** قارئ بايتات الأجسام الموثقة عبر منفذ التخزين المحقون عند التركيب في app.ts (072 D-4، P-4). */
export interface ServiceImportObjectBytes {
  /**
   * يقرأ بايتات محدودة في الذاكرة من كائن موثّق.
   *
   * @param key مفتاح التخزين الداخلي
   * @param maxBytes حد الذاكرة
   * @returns بايتات الكائن
   */
  read(key: string, maxBytes: number): Promise<Uint8Array>;
}

/** حقيقة الملف على معاملة جاهزة: يعرف المستهلك حقائق ملف files دون سهم استيراد نحو files. */
export interface ServiceImportFileFactsPort {
  /**
   * يقرأ حقائق الملف الموثّق داخل الشركة على المعاملة الجارية.
   *
   * @param tx        معاملة المستأجر الجارية
   * @param companyId الشركة
   * @param fileId    معرّف الملف
   * @returns حقائق الملف أو null
   */
  facts(tx: unknown, companyId: string, fileId: string): Promise<ServiceImportFileFacts | null>;
}

/** قارئ الورقة الأولى بالقيم والتنسيقات بحدود الكيان الثابتة: يُنفَّذ في persistence بـ ExcelJS (P-1). */
export interface ServiceImportSheetReader {
  /**
   * يقرأ الورقة الأولى من مصنف `.xlsx` بحدود الكيان المعلنّة.
   *
   * @param bytes محتوى المصنف
   * @returns القيم مع تنسيقاتها المحاذاة
   */
  read(bytes: Uint8Array): Promise<{
    matrix: readonly (readonly (string | number | boolean | null)[])[] & {
      readonly sourceRows?: readonly number[];
    };
    formats: readonly (readonly (string | undefined)[])[];
  }>;
}

/** بانِي قالب الاستيراد: يحوّل تصنيفات النشاط المفتوحة إلى مصنف base64 قابل للتنزيل. */
export interface ServiceImportTemplateBuilder {
  /**
   * يبني مصنف القالب لتصنيفات نشاط واحد ويمرّر الناتج على القارئ المحمي نفسه (P-3).
   *
   * @param categories تصنيفات النشاط المفتوحة بأسمائها
   * @returns المصنف مشفّراً بـ base64
   */
  build(categories: readonly ServiceImportCategoryOption[]): Promise<string>;
}
