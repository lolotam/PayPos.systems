import type { PackageImportPreviewStatus } from '@pospay/contracts';
import { t, type Locale, type MessageKey } from '@pospay/i18n';

type PackageImportStatusErrorCode = Extract<
  PackageImportPreviewStatus,
  { status: 'failed' }
>['error_code'];

// الأعمدة المرقّمة: خدمة وجلسات ومتبقٍ لكل مجموعة من العشرين.
const NUMBERED_COLUMN = /^(service|sessions|remaining)_([1-9]|1[0-9]|20)$/;
const BASE_COLUMNS = [
  'customer_phone',
  'name_en',
  'name_ar',
  'price_paid',
  'expires_on',
  'external_ref',
];

/**
 * اسم العمود المعروض لمستخدم الشاشة: الأعمدة الثابتة من الكتالوج، والمرقّمة باسم نوعها مع رقم المجموعة.
 *
 * @param locale اللغة الحالية
 * @param column اسم العمود كما أرسله الـ API
 * @returns النص المترجم؛ عمود غير معروف يظهر بعنوان «عمود غير متوقع»
 */
export function packageImportColumnLabel(locale: Locale, column: string): string {
  if (BASE_COLUMNS.includes(column)) return t(locale, `packageImport.col_${column}` as MessageKey);
  const numbered = NUMBERED_COLUMN.exec(column);
  if (numbered?.[1] && numbered[2])
    return `${t(locale, `packageImport.col_${numbered[1]}` as MessageKey)} ${numbered[2]}`;
  return t(locale, 'packageImport.col_unexpected_column');
}

/**
 * سبب خطأ الصف مترجماً؛ كود غير مسجّل في كتالوج الاستيراد يرجع إلى كتالوج الأخطاء العام.
 *
 * @param locale اللغة الحالية
 * @param code كود الخطأ كما أرسله الـ API
 * @returns النص المترجم
 */
export function packageImportErrorReason(locale: Locale, code: string): string {
  const own = `packageImport.code_${code}` as MessageKey;
  const text = t(locale, own);
  return text === own ? t(locale, `errors.${code}` as MessageKey) : text;
}

const OWN_STATUS_CODES: readonly string[] = [
  'IMPORT_SERVICE_NOT_FOUND',
  'IMPORT_PREVIEW_EXPIRED',
  'IMPORT_PREVIEW_HAS_ERRORS',
  'IMPORT_COMMIT_FAILED',
];

/**
 * مفتاح رسالة سبب فشل الاستيراد: رموز التثبيت من كتالوج الباقات، وأخطاء الملف من كتالوج الأخطاء العام.
 *
 * @param code كود الفشل كما ورد من الـ API
 * @returns مفتاح الرسالة
 */
export function packageImportStatusErrorMessage(code: PackageImportStatusErrorCode): MessageKey {
  return (
    OWN_STATUS_CODES.includes(code) ? `packageImport.code_${code}` : `errors.${code}`
  ) as MessageKey;
}
