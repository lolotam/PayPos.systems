import type { ParsedPackageImportRow, PackageImportRowError } from './package-import-row.ts';

/** حقائق الملف من files؛ الرفض موحّد للملف الخارج عن النشاط أو الملكية. */
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
/** حدود باقات الاستيراد، مستقلة عن حدود الموظفين. */
export const PACKAGE_IMPORT_BOUNDS = {
  maxBytes: 2 * 1024 * 1024,
  maxDataRows: 500,
  maxColumns: 68,
  maxWorksheets: 4,
} as const;
/** صيغة مصنف الاستيراد الوحيدة. */
export const PACKAGE_IMPORT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** رفض الملف أو الإذن بلا بيانات خلايا أو هاتف. */
export class PackageImportError extends Error {
  /** رفض آمن متوقع أثناء طلب المعاينة.
   *
   * @param code سبب رفض آمن يطابق غلاف API القائم */
  constructor(
    readonly code:
      | 'FORBIDDEN'
      | 'FEATURE_DISABLED'
      | 'IMPORT_FILE_NOT_FOUND'
      | 'IMPORT_FILE_NOT_READY'
      | 'IMPORT_FILE_TYPE_INVALID'
      | 'IMPORT_FILE_SIZE_INVALID'
      | 'IMPORT_FILE_CONTENT_INVALID'
      | 'IMPORT_HEADER_INVALID'
      | 'IMPORT_ROW_LIMIT_EXCEEDED'
      | 'STORAGE_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'PackageImportError';
  }
}
/** فشل عابر آمن بلا cause؛ رسالة المزود أو معاملات SQL قد تحتوي هاتفًا أو مفتاح ملف. */
export class PackagePreviewRetryError extends Error {
  /** يطلب إعادة المحاولة برمز ثابت لا يحمل أي بيانات مصدر. */
  constructor() { super('PACKAGE_PREVIEW_RETRY'); this.name = 'PackagePreviewRetryError'; }
}
/** صف محفوظ خالٍ من الهاتف الكامل، قابل لاستهلاك 47-2 لاحقاً. */
export type PackageImportCandidate = Omit<ParsedPackageImportRow, 'phone'> & {
  readonly customer_id: string;
  readonly phone_last3: string;
};
/** ناتج المعاينة الآمن للتخزين. */
export interface PackageImportValidation {
  readonly rows: readonly PackageImportCandidate[];
  readonly errors: readonly PackageImportRowError[];
  readonly skipped: readonly { readonly row: number; readonly external_ref: string }[];
}
/**
 * يثبت ملكية الملف وحالته وحدوده قبل طلب بايتاته من التخزين.
 *
 * @param facts حقائق الملف تحت RLS
 * @param actor صاحب الطلب والنشاط
 * @param actor.businessId النشاط المتحقق منه
 * @param actor.userId صاحب الملف
 * @returns مفتاح التخزين الداخلي الموثوق
 */
export function packageImportStorageKey(
  facts: PackageImportFileFacts | null,
  actor: { businessId: string; userId: string },
): string {
  if (
    facts === null ||
    facts.business_id !== actor.businessId ||
    facts.created_by !== actor.userId ||
    facts.purged ||
    facts.purge_started
  )
    throw new PackageImportError('IMPORT_FILE_NOT_FOUND');
  if (facts.status !== 'READY' || facts.storage_key === null)
    throw new PackageImportError('IMPORT_FILE_NOT_READY');
  if (facts.content_type !== PACKAGE_IMPORT_CONTENT_TYPE)
    throw new PackageImportError('IMPORT_FILE_TYPE_INVALID');
  if (facts.size_bytes < 1 || facts.size_bytes > PACKAGE_IMPORT_BOUNDS.maxBytes)
    throw new PackageImportError('IMPORT_FILE_SIZE_INVALID');
  return facts.storage_key;
}
/**
 * يحسب نهاية عمر المعاينة من الساعة المحقونة مثل إطار الموظفين القائم.
 *
 * @param at لحظة الإنشاء
 * @returns تاريخ الانتهاء بعد 24 ساعة
 */
export function packagePreviewExpiresAt(at: Date): string {
  return new Date(at.getTime() + 86400000).toISOString();
}
