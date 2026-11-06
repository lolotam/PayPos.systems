import type { ImportCell } from '../domain/package-import-cells.ts';
import type { PackageImportService } from '../domain/package-import-row.ts';
import type { PackageImportFileFacts, PackageImportValidation } from '../domain/package-import.ts';

/**
 * صف مصدر بعد فحص المصنف؛ الخلايا والهواتف تفضل في ذاكرة المهمة فقط.
 */
export interface PackagePreviewSheet {
  readonly rows: readonly { readonly row: number; readonly cells: readonly ImportCell[] }[];
}
/**
 * هوية المعاينة وحقيقة الملف الموثقة تحت نفس المستأجر.
 */
export interface PendingPackagePreview {
  readonly id: string;
  readonly businessId: string;
  readonly userId: string;
  readonly fileId: string;
  readonly expiresAt: string;
  readonly file: PackageImportFileFacts | null;
}
/**
 * قراءة المزود والمصنف منفصلة عن أي معاملة قاعدة بيانات.
 */
export interface PackagePreviewWorkbook {
  /**
   * يقرأ المصنف خارج المعاملة.
   *
   * @param key مفتاح موثق من facts
   * @returns صفوف وخلايا محدودة فقط
   */
  read(key: string): Promise<PackagePreviewSheet>;
}
/**
 * لقطة القرار المقفلة؛ العملاء بيرجعوا الهوية وآخر ثلاثة أرقام فقط.
 */
export interface PackagePreviewScope extends CustomerLookupPort {
  readonly preview: PendingPackagePreview | null;
  /**
   * @returns خدمات النشاط المطابقة لأسماء المصنف
   */
  services(): Promise<readonly PackageImportService[]>;
  /**
   * يقرأ المراجع المستوردة في دفعة واحدة.
   *
   * @param refs مراجع الملف المحدودة
   * @returns المراجع الموجودة في الشركة
   */
  existingRefs(refs: readonly string[]): Promise<readonly string[]>;
  /**
   * يثبت النتيجة مرة واحدة داخل القفل.
   *
   * @param sourceRows أرقام صفوف المصدر الفعلية لإثبات التقسيم
   * @param result صفوف آمنة وأخطاء وتخطيات
   * @returns اكتمال الحفظ
   */
  ready(sourceRows: readonly number[], result: PackageImportValidation): Promise<void>;
}
/** بحث العملاء الدفعي للاستيراد؛ لا يرجع الهاتف الكامل خارج المحول. */
export interface CustomerLookupPort {
  /**
   * يزيل الهاتف الكامل من ناتج البحث.
   *
   * @param phones هواتف مؤقتة في الذاكرة
   * @returns هوية وآخر ثلاثة أرقام أو null
   */
  findByPhones(phones: readonly string[]): Promise<readonly ({ id: string; phone_last3: string } | null)[]>;
}
/**
 * معاملات قصيرة لتحميل الحقائق وتثبيت النتيجة؛ لا وصول لمزود من داخلها.
 */
export interface PackagePreviewTransactions {
  /**
   * يقرأ المعاينة المعلقة تحت RLS.
   *
   * @param companyId الشركة
   * @param previewId المعاينة
   * @returns الحقائق أو null للنهائية والغائبة
   */
  load(companyId: string, previewId: string): Promise<PendingPackagePreview | null>;
  /**
   * يقفل المعاينة ويعيد فحص حقائقها قبل القرار.
   *
   * @param companyId الشركة
   * @param previewId المعاينة
   * @param work القرار داخل معاملة واحدة
   * @returns نتيجة القرار
   */
  finish<T>(
    companyId: string,
    previewId: string,
    work: (scope: PackagePreviewScope) => Promise<T>,
  ): Promise<T>;
  /**
   * يفشل pending فقط حتى لا يكتب فوق نتيجة عامل آخر.
   *
   * @param companyId الشركة
   * @param previewId المعاينة
   * @param code رمز آمن بلا محتوى ملف
   * @returns اكتمال القرار الشرطي
   */
  fail(companyId: string, previewId: string, code: string): Promise<void>;
}
/**
 * ساعة محقونة؛ الوقت الحقيقي بيتحدد في تركيب العامل.
 */
export interface PackagePreviewClock {
  /**
   * @returns لحظة القرار المحقونة
   */
  now(): Date;
}
