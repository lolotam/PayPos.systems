/** هوية طلب المعاينة؛ الشركة والمستخدم يأتيان من الحارس، لا من جسم الطلب. */
export interface PackageImportActor {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
}

/** حقائق الملف فقط؛ لا تمر بايتات المصنف داخل مسار قبول الطلب. */
export interface PackageImportFileFacts {
  readonly business_id: string;
  readonly created_by: string;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly status: string;
  readonly storage_key: string | null;
  readonly purged: boolean;
  readonly purge_started: boolean;
}

/** الحد المتحقق منه عند قبول الطلب؛ العامل يحافظ على بقية حدود المصنف في 47-1b. */
export const PACKAGE_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/** رفض متوقع بلا بيانات ملف خارج الملكية أو تفاصيل مزود التخزين. */
export class PackageImportRequestError extends Error {
  /**
   * يحتفظ بسبب الرفض الآمن الذي يحوله HTTP إلى الغلاف الموجود.
   *
   * @param code سبب رفض قبول الطلب
   */
  constructor(
    readonly code:
      | 'FORBIDDEN'
      | 'FEATURE_DISABLED'
      | 'IMPORT_FILE_NOT_FOUND'
      | 'IMPORT_FILE_NOT_READY'
      | 'IMPORT_FILE_TYPE_INVALID'
      | 'IMPORT_FILE_SIZE_INVALID',
  ) {
    super(code);
    this.name = 'PackageImportRequestError';
  }
}

/** صف طلب جديد؛ النتائج فارغة والحالة pending داخل محول التخزين. */
export interface PendingPackagePreview {
  readonly id: string;
  readonly fileId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * يرفض الملف الخارج عن النشاط أو صاحب الطلب قبل قراءة أي محتوى.
 *
 * @param facts حقائق الملف تحت RLS
 * @param actor هوية الطلب المتحقق منها
 * @returns لا شيء عند قبول حقائق الملف
 */
export function requirePackageImportFile(
  facts: PackageImportFileFacts | null,
  actor: PackageImportActor,
): void {
  if (
    facts === null ||
    facts.business_id !== actor.businessId ||
    facts.created_by !== actor.userId ||
    facts.purged ||
    facts.purge_started
  )
    throw new PackageImportRequestError('IMPORT_FILE_NOT_FOUND');
  if (facts.status !== 'READY' || facts.storage_key === null)
    throw new PackageImportRequestError('IMPORT_FILE_NOT_READY');
  if (facts.content_type !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    throw new PackageImportRequestError('IMPORT_FILE_TYPE_INVALID');
  if (facts.size_bytes < 1 || facts.size_bytes > PACKAGE_IMPORT_MAX_BYTES)
    throw new PackageImportRequestError('IMPORT_FILE_SIZE_INVALID');
}

/**
 * يثبت لحظة الطلب ونهاية عمره من الساعة المحقونة؛ عمر المعاينة 24 ساعة كالإطار القائم.
 *
 * @param id هوية المعاينة المولدة
 * @param fileId هوية الملف المتحقق منه
 * @param at لحظة قبول الطلب
 * @returns بيانات صف pending بلا نتائج أو بايتات مصنف
 */
export function pendingPackagePreview(id: string, fileId: string, at: Date): PendingPackagePreview {
  return {
    id,
    fileId,
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 86_400_000).toISOString(),
  };
}
