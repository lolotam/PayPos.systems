import type {
  EmployeeImportCandidate,
  EmployeeImportFileFacts,
  EmployeeImportRowError,
} from '../domain/employee-import.ts';

/** فرع نشاط يقرأه الاستيراد لبناء خريطة الأسماء. */
export interface ImportBranch {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
}

/** معاينة محفوظة تُقرأ داخل معاملة الالتزام. */
export interface StoredImportPreview {
  readonly id: string;
  readonly business_id: string;
  readonly created_by: string;
  /** حالة الالتزام التي تمنع طلبين من إنشاء وظيفتين. */
  readonly status: 'ready' | 'commit_requested' | 'committed' | 'failed';
  readonly committed_at: string | null;
  readonly expires_at: string;
  readonly rows: readonly EmployeeImportCandidate[];
  readonly errors: readonly EmployeeImportRowError[];
}

/** مدخلات حفظ معاينة جديدة، بلا كتابة أي موظف. */
export interface SaveImportPreviewInput {
  readonly rowCount: number;
  readonly id: string;
  readonly businessId: string;
  readonly entity: string;
  readonly fileId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly rows: readonly EmployeeImportCandidate[];
  readonly errors: readonly EmployeeImportRowError[];
}

/** نطاق المعاينة: إثبات الإذن، قراءة الملف والفروع، وحفظ المعاينة. */
export interface ImportPreviewScope {
  /**
   * يقرأ إدارة الموظفين في النشاط دون أقفال كتابة ويرفض الميزة المعطلة بخطأ مسمى.
   *
   * @param businessId النشاط المستهدف
   * @returns هل يملك الإذن الحي
   */
  authorize(businessId: string): Promise<boolean>;
  /**
   * يقرأ حقائق الملف الموثّق داخل الشركة، ويرجّع null للمجهول أو الخارج عن الملكية.
   *
   * @param fileId معرف الملف
   * @returns حقائق الملف أو null
   */
  fileFacts(fileId: string): Promise<EmployeeImportFileFacts | null>;
  /**
   * يقرأ فروع النشاط لأسماء الفروع في الورقة.
   *
   * @param businessId النشاط المستهدف
   * @returns فروع النشاط
   */
  branches(businessId: string): Promise<readonly ImportBranch[]>;
  /**
   * يحفظ المعاينة وصفوفها وأخطاءها دون كتابة موظف.
   *
   * @param input بيانات المعاينة
   * @returns اكتمال الحفظ
   */
  save(input: SaveImportPreviewInput): Promise<void>;
}

/** نطاق الطلب: قراءة المعاينة بالقفل وتسجيل طلب الوظيفة وحدثه. */
export interface ImportCommitScope {
  /**
   * يثبت إدارة الموظفين في النشاط تحت أقفال PR 7.
   *
   * @param businessId النشاط المستهدف
   * @returns هل يملك الإذن الحي
   */
  authorize(businessId: string): Promise<boolean>;
  /**
   * يقرأ المعاينة بالقفل FOR UPDATE للتحقق من الانتهاء والاستهلاك مرة واحدة.
   *
   * @param previewId معرف المعاينة
   * @returns المعاينة أو null للمجهول/الخارج عن النشاط
   */
  load(previewId: string): Promise<StoredImportPreview | null>;
  /**
   * يسجل طلب الوظيفة وحدثه داخل المعاملة؛ لا ينشئ موظفين في API.
   *
   * @param previewId معرف المعاينة المقفلة
   * @param requestedAt لحظة قبول الطلب من الساعة المحقونة
   */
  request(previewId: string, requestedAt: string): Promise<void>;
}

/** حد المعاملات يسمح باختبار التنسيق دون قاعدة بيانات. */
export interface EmployeeImportTransactions {
  /**
   * يدخل الشركة المتحقق منها لقراءة الملف والفروع أو لحفظ المعاينة.
   *
   * @param actor الهوية المتحقق منها
   * @param actor.companyId الشركة المستهدفة
   * @param actor.userId المستخدم المستورد
   * @param work عملية المعاينة
   * @returns ناتج العملية
   */
  runPreview<T>(
    actor: { companyId: string; userId: string },
    work: (scope: ImportPreviewScope) => Promise<T>,
  ): Promise<T>;
  /**
   * يدخل الشركة ويضم قراءة المعاينة والإنشاء والأحداث والاستهلاك في commit واحد مع مفتاح idempotency.
   *
   * @param actor الهوية المتحقق منها
   * @param actor.companyId الشركة المستهدفة
   * @param actor.userId المستخدم المستورد
   * @param actor.previewId المعاينة التي يثبت ملكيتها قبل إعادة الرد
   * @param actor.businessId النشاط الذي يثبت إذنه قبل مطالبة المفتاح
   * @param actor.key مفتاح idempotency
   * @param actor.fingerprint بصمة الطلب (معرف المعاينة)
   * @param work عملية الالتزام
   * @returns قبول الطلب بمعرف المعاينة وفق المخطط الحالي، حتى عند إعادة الرد القديم
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
    work: (scope: ImportCommitScope) => Promise<{ preview_id: string }>,
  ): Promise<{ preview_id: string }>;
}

/** قارئ بايتات الأجسام الموثقة عبر منفذ التخزين المحقون. */
export interface ObjectBytesReader {
  /**
   * يقرأ بايتات محدودة في الذاكرة من كائن موثّق.
   *
   * @param key مفتاح التخزين الداخلي
   * @param maxBytes حد الذاكرة
   * @returns بايتات الكائن
   */
  read(key: string, maxBytes: number): Promise<Uint8Array>;
}

/** قارئ الورقة: يحوّل بايتات المصنف إلى خلايا أولية (يُنفَّذ في persistence بـ exceljs). */
export interface ImportSheetReader {
  /**
   * يقرأ الورقة الأولى من مصنف `.xlsx`.
   *
   * @param bytes محتوى المصنف
   * @returns صفوف الورقة كخلايا أولية
   */
  read(bytes: Uint8Array): Promise<readonly (readonly (string | number | boolean | null)[])[]>;
}

/** بانِي قالب الاستيراد: يحوّل فروع النشاط إلى مصنف base64 قابل للتنزيل. */
export interface ImportTemplateBuilder {
  /**
   * يبني مصنف القالب لفروع نشاط واحد.
   *
   * @param branches فروع النشاط
   * @returns المصنف مشفّراً بـ base64
   */
  build(branches: readonly ImportBranch[]): Promise<string>;
}
