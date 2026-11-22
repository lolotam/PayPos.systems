/**
 * مولّد معرفات UUID v7 واجهة محلية صغرى: التركيب يمدّ المولّد الحالي بنيوياً (نمط
 * منفذ files للعامل)، فلا يعتمد منفذ التطبيق على حزمة قاعدة البيانات إطلاقاً.
 */
export interface IdGenerator {
  /** ينتج معرفاً جديداً بترقيم UUID v7 مرتّب زمنياً. */
  newId(): string;
}
import type {
  ImportedServiceRecord,
  ServiceImportNormalizedRow,
} from '../domain/service-import-commit.ts';

/** المعاينة المقفولة كما يقرأها العامل داخل معاملة الالتزام، بلا صفوف لو الحالة ليست طلباً حياً. */
export interface ServiceImportCommitPreview {
  readonly id: string;
  readonly business_id: string;
  readonly created_by: string;
  readonly requested_at: string;
  readonly expires_at: string;
  readonly error_count: number;
  readonly rows: readonly ServiceImportNormalizedRow[];
}

/** نطاق معاملة الالتزام: القفل الاستشاري وقراءة النشاط والأسماء الحاسمة وقفل التصنيفات والكتابة والإتمام. */
export interface ServiceImportCommitScope {
  /**
   * يقفل الالتزام الاستشاري للشركة والنشاط والغرض داخل المعاملة قبل القراءة الحاسمة (FR-009).
   *
   * @param businessId النشاط الذي يُقفل عليه الالتزام
   */
  lockImport(businessId: string): Promise<void>;
  /**
   * يقرأ وجود النشاط على معاملة الالتزام نفسها، فالنشاط الغائب بعد القبول فشل تثبيت مُسمّى.
   *
   * @param businessId النشاط المستهدف
   * @returns هل النشاط موجود
   */
  businessExists(businessId: string): Promise<boolean>;
  /**
   * يقرأ مفاتيح أسماء الخدمات الموجودة فعلاً في النشاط، المفتوحة والمقفولة معاً، بالقراءة الحاسمة
   * المطولة على الطرفين داخل PostgreSQL (A-11/HIGH مراجعة 1186).
   *
   * @param businessId النشاط صاحب الخدمات
   * @param names      أسماء صفوف المعاينة المطلقة بعد تشذيب المحوّل
   * @returns مفاتيح الأسماء المتصادمة في النشاط
   */
  existingNameKeys(businessId: string, names: readonly string[]): Promise<readonly string[]>;
  /**
   * يقفل التصنيفات المُحالة بترتيبها الصاعد FOR SHARE ويعيد حالة كل تصنيف مطلوب (FR-009).
   *
   * @param businessId النشاط صاحب التصنيفات
   * @param categoryIds معرّفات مطلّقة صاعدة
   * @returns خريطة معرّف التصنيف إلى لافتة إغلاقه إن وُجد
   */
  lockCategories(
    businessId: string,
    categoryIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly closed_at: string | null }>>;
  /**
   * يكتب الخدمات وتدقيقها في المعاملة الواحدة، بلا أي حدث outbox لكل خدمة.
   *
   * @param records الخدمات المبنية بمعرّفات محقونة
   */
  insert(records: readonly ImportedServiceRecord[]): Promise<void>;
  /**
   * يثبت حالة المعاينة وعددها المُنشأ ولحظة الإتمام في نفس المعاملة.
   *
   * @param preview  المعاينة المقفولة
   * @param count    عدد الخدمات المكتوبة
   * @param at       لحظة الإتمام الواحدة من الساعة المحقونة
   */
  complete(preview: ServiceImportCommitPreview, count: number, at: string): Promise<void>;
}

/** معاملات الالتزام: المعاملة الواحدة وفشلها الشرطي بعد التراجع في معاملة مستأجر مستقلة. */
export interface ServiceImportCommitTransactions {
  /**
   * يدخل الشركة ويقفل المعاينة FOR UPDATE ويسلّم النطاق لعمل واحد؛ بلا صف حي بالنطاق يُسلَّم نطاق بلا معاينة.
   *
   * @param companyId الشركة من مغلف الحدث
   * @param previewId معرّف المعاينة من الحدث
   * @param work      عمل الالتزام داخل المعاملة
   * @returns ناتج العمل
   */
  run(
    companyId: string,
    previewId: string,
    work: (scope: {
      readonly preview: ServiceImportCommitPreview | null;
    } & ServiceImportCommitScope) => Promise<void>,
  ): Promise<void>;
  /**
   * يفشل الطلب الحي فقط: الشرط على الحالة `commit_requested` بعد تراجع معاملة الكتابة كلها.
   *
   * @param companyId الشركة
   * @param previewId معرّف المعاينة
   * @param code      رمز الفشل المستقر
   */
  fail(companyId: string, previewId: string, code: string): Promise<void>;
}
