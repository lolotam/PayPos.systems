import type {
  CustomerImportColumn,
  CustomerImportErrorCode,
  CustomerImportStatus,
} from '@pospay/contracts';
import { t, type Locale, type MessageKey } from '@pospay/i18n';

/** نطاق الاستيراد: النشاط، أو الفرع حين يكون المستخدم مقيّداً بفرعه (CI-T5). */
export type CustomerImportTargetScope = {
  companyId: string;
  businessId: string;
  branchId?: string;
  userId: string;
};

const KNOWN_COLUMNS: ReadonlySet<string> = new Set([
  'name',
  'phone',
  'country_code',
  'locale',
  'no_rating',
  'birthday',
  'year_known',
  'gender',
  'email',
  'notes',
]);

const OWN_CODES: ReadonlySet<string> = new Set([
  'IMPORT_REQUIRED_CELL',
  'IMPORT_NAME_INVALID',
  'IMPORT_PHONE_INVALID',
  'IMPORT_COUNTRY_CODE_INVALID',
  'IMPORT_LOCALE_INVALID',
  'IMPORT_BOOLEAN_INVALID',
  'IMPORT_DATE_INVALID',
  'IMPORT_YEAR_KNOWN_REQUIRED',
  'IMPORT_GENDER_INVALID',
  'IMPORT_EMAIL_INVALID',
  'IMPORT_NOTE_INVALID',
  'IMPORT_CELL_INVALID',
  'IMPORT_COLUMN_UNEXPECTED',
  'IMPORT_DUPLICATE_IN_FILE',
]);

/**
 * يختار مفتاح رسالة كود نتيجة الحفظ، فتبقى الرسالة في اللغتين ومترجمة من i18n.
 *
 * @param code كود النتيجة كما ورد من الـ API
 * @returns مفتاح الرسالة
 */
export function customerImportStatusErrorMessage(
  code: NonNullable<CustomerImportStatus['error_code']>,
): MessageKey {
  return `customerImport.commit_${code}`;
}

/**
 * يترجم اسم العمود في جدول الأخطاء؛ العمود غير المعروف يسقط على «عمود غير متوقع».
 *
 * @param locale لغة العرض
 * @param column اسم العمود كما ورد من الـ API
 * @returns عنوان العمود مترجماً
 */
export function customerImportColumnLabel(
  locale: Locale,
  column: CustomerImportColumn | string,
): string {
  const key = KNOWN_COLUMNS.has(column) ? column : 'unexpected_column';
  return t(locale, `customerImport.col_${key}` as MessageKey);
}

/**
 * يترجم كود خطأ الصف؛ الكود الذي ليس في قسم الاستيراد يسقط على قسم الأخطاء العام.
 *
 * @param locale لغة العرض
 * @param code كود الخطأ كما ورد من الـ API
 * @returns سبب الخطأ مترجماً
 */
export function customerImportErrorReason(
  locale: Locale,
  code: CustomerImportErrorCode | string,
): string {
  const key = OWN_CODES.has(code) ? `customerImport.code_${code}` : `errors.${code}`;
  return t(locale, key as MessageKey);
}
