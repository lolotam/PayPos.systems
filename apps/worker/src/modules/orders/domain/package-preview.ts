import { cellText, type ImportCell } from './package-import-cells.ts';
import {
  PackageImportError,
  packageImportStorageKey,
  type PackageImportFileFacts,
} from './package-import.ts';

/**
 * يرفض انتهاء مهلة المعاينة أو تغيّر الملف قبل تثبيت النتيجة.
 *
 * @param preview الحقائق المحملة
 * @param preview.file ملف المعاينة
 * @param preview.businessId النشاط
 * @param preview.userId صاحب الطلب
 * @param preview.expiresAt انتهاء المعاينة
 * @param at لحظة القرار
 * @param expectedKey مفتاح القراءة السابق عند إعادة الفحص
 * @returns المفتاح الموثق
 */
export function packagePreviewKey(
  preview: {
    readonly file: PackageImportFileFacts | null;
    readonly businessId: string;
    readonly userId: string;
    readonly expiresAt: string;
  },
  at: Date,
  expectedKey?: string,
): string {
  const key = packageImportStorageKey(preview.file, preview);
  if (new Date(preview.expiresAt) <= at || (expectedKey !== undefined && key !== expectedKey))
    throw new PackageImportError('IMPORT_FILE_NOT_FOUND');
  return key;
}

/**
 * يجمع المراجع المحدودة للبحث الدفعي؛ المحتوى غير الصالح يفضل للـvalidator.
 *
 * @param rows صفوف المصدر
 * @returns مراجع محدودة في الذاكرة
 */
export function packagePreviewRefs(
  rows: readonly { readonly cells: readonly ImportCell[] }[],
): string[] {
  return rows
    .map(({ cells }) => cellText(cells[5] ?? null))
    .filter((ref): ref is string => ref !== null && ref.length <= 100);
}
