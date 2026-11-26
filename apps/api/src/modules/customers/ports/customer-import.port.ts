import type { Tx } from '@pospay/db';

import type {
  CustomerImportCommitPreview,
  CustomerImportFileFacts,
  CustomerImportRow,
  CustomerImportRowIssue,
  CustomerImportSheetRow,
} from '../domain/customer-import.ts';

/** نطاق الاستيراد: نشاط أو فرع؛ الفرع بيتحل لنشاطه داخل المعاملة (CI-T5). */
export type CustomerImportScope =
  | { readonly kind: 'business'; readonly id: string }
  | { readonly kind: 'branch'; readonly id: string };

/** مدخلات المعاملات: الشركة والمستخدم والنطاق المستهدف. */
export interface CustomerImportScopeInput {
  readonly companyId: string;
  readonly userId: string;
  readonly scope: CustomerImportScope;
}

/** مدخلات حفظ المعاينة الجاهزة: صفوف مطبّعة وأخطاء مسمّاة، بلا كتابة أي عميل. */
export interface SaveCustomerImportPreviewInput {
  readonly id: string;
  readonly businessId: string;
  readonly fileId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly rowCount: number;
  readonly rows: readonly CustomerImportRow[];
  readonly errors: readonly CustomerImportRowIssue[];
}

/** نطاق المعاينة الأول: النشاط ودولة النشاط وحقائق الملف. */
export interface CustomerImportFactsScope {
  readonly businessId: string;
  readonly countryCode: string | null;
  readonly facts: CustomerImportFileFacts | null;
}

/** نطاق المعاينة الثاني: الهواتف الموجودة وحفظ المعاينة وتدقيق الوصول للملف. */
export interface CustomerImportSaveScope {
  readonly businessId: string;
  /**
   * يقرأ الهواتف الموجودة في الشركة دفعة واحدة.
   *
   * @param phones الهواتف المطبّعة
   */
  existingPhones(phones: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * يحفظ المعاينة الجاهزة وصفوفها وأخطاءها بلا كتابة عميل.
   *
   * @param input بيانات المعاينة
   */
  save(input: SaveCustomerImportPreviewInput): Promise<void>;
  /**
   * يسجّل دخولاً تدقيقياً على الوصول للملف (CLAUDE.md §8).
   *
   * @param fileId معرّف الملف
   */
  auditFileAccess(fileId: string): Promise<void>;
}

/** نطاق القبول: قراءة المعاينة المقفلة وتسجيل طلب التثبيت وحدثه. */
export interface CustomerImportCommitScope {
  readonly businessId: string;
  /**
   * يقرأ المعاينة المقفلة FOR UPDATE.
   *
   * @param previewId معرّف المعاينة
   */
  load(previewId: string): Promise<CustomerImportCommitPreview | null>;
  /**
   * ينقل المعاينة لحالة الطلب ويكتب الحدث معاً.
   *
   * @param previewId   معرّف المعاينة
   * @param requestedAt لحظة القبول
   */
  request(previewId: string, requestedAt: string): Promise<void>;
}

/** حدود معاملات الاستيراد تفصل قراءة التخزين عن قاعدة البيانات. */
export interface CustomerImportTransactions {
  /**
   * يحل النطاق ويقرأ دولة النشاط وحقائق الملف.
   *
   * @param input النطاق والملف
   * @param work  العمل
   */
  runFacts<T>(
    input: CustomerImportScopeInput & { readonly fileId?: string },
    work: (scope: CustomerImportFactsScope) => Promise<T>,
  ): Promise<T>;
  /**
   * يقرأ الهواتف الموجودة ويحفظ المعاينة ويدقّق الملف.
   *
   * @param input النطاق والملف
   * @param work  العمل
   */
  runSave<T>(
    input: CustomerImportScopeInput & { readonly fileId: string },
    work: (scope: CustomerImportSaveScope) => Promise<T>,
  ): Promise<T>;
  /**
   * يقفل المعاينة وينفّذ القبول مع idempotency والحدث.
   *
   * @param input الطلب ومفتاح الـ idempotency
   * @param work  العمل
   */
  runCommit<T>(
    input: CustomerImportScopeInput & {
      readonly previewId: string;
      readonly key: string;
      readonly fingerprint: string;
    },
    work: (scope: CustomerImportCommitScope) => Promise<T>,
  ): Promise<T>;
}

/** حقيقة الملف على معاملة جاهزة دون سهم استيراد نحو files. */
export interface CustomerImportFileFactsPort {
  /**
   * يقرأ حقائق الملف.
   *
   * @param tx        المعاملة
   * @param companyId الشركة
   * @param fileId    الملف
   */
  facts(tx: Tx, companyId: string, fileId: string): Promise<CustomerImportFileFacts | null>;
}

/** قارئ بايتات الكائن الموثّق من التخزين الممرّر عبر app.ts. */
export interface CustomerImportObjectBytes {
  /**
   * يقرأ بايتات كائن محدود الحجم من التخزين.
   *
   * @param key      مفتاح الكائن
   * @param maxBytes الحد الأقصى للبايتات
   */
  read(key: string, maxBytes: number): Promise<Uint8Array>;
}

/** ربطات الملفات الممرّرة من app.ts. */
export interface CustomerImportFilesBinding {
  readonly fileFacts: CustomerImportFileFactsPort;
  readonly bytes: CustomerImportObjectBytes | null;
}

/** بانِي قالب الاستيراد. */
export interface CustomerImportTemplateBuilder {
  /** يبني مصنف القالب مشفّراً بـ base64. */
  build(): Promise<string>;
}

/** قارئ الورقة الأولى بحدود الكيان الثابتة. */
export interface CustomerImportSheetReader {
  /**
   * يقرأ الورقة الأولى من مصنف `.xlsx` ويتحقّق من العناوين والحدود.
   *
   * @param bytes بايتات المصنف
   */
  read(bytes: Uint8Array): Promise<readonly CustomerImportSheetRow[]>;
}
