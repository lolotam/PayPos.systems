/** علامة خلية تعذّرت قراءتها من محرك المصنفات، مطابقة لـ INVALID_CELL (ADR-0034). */
export const CUSTOMER_IMPORT_INVALID_CELL = '\u0000import-invalid-cell\u0000';

/** رموز رفض معاينة استيراد العملاء وأمره؛ تطابق خريطة أخطاء الـ HTTP في shared/errors.ts. */
export type CustomerImportErrorCode =
  | 'IMPORT_FILE_NOT_FOUND'
  | 'IMPORT_FILE_NOT_READY'
  | 'IMPORT_FILE_TYPE_INVALID'
  | 'IMPORT_FILE_SIZE_INVALID'
  | 'IMPORT_FILE_CONTENT_INVALID'
  | 'STORAGE_UNAVAILABLE'
  | 'IMPORT_HEADER_INVALID'
  | 'IMPORT_ROW_LIMIT_EXCEEDED'
  | 'IMPORT_BUSINESS_COUNTRY_REQUIRED'
  | 'IMPORT_PREVIEW_NOT_FOUND'
  | 'IMPORT_PREVIEW_EXPIRED'
  | 'IMPORT_PREVIEW_HAS_ERRORS'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'TRANSACTION_RETRY_REQUIRED';

/** حدود استيراد العملاء: حجم الملف وعدد الصفوف وعدد الأعمدة (ADR-0034 addendum §3). */
export const CUSTOMER_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const CUSTOMER_IMPORT_MAX_ROWS = 500;
export const CUSTOMER_IMPORT_MAX_COLUMNS = 20;
export const CUSTOMER_IMPORT_PREVIEW_TTL_MS = 86_400_000;
export const CUSTOMER_IMPORT_OWNER_MODULE = 'customers';
export const CUSTOMER_IMPORT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** أعمدة ورقة الاستيراد بالترتيب المرجعي؛ ترتيبها هو مرجع القالب والمعاينة معاً (073 FR-001). */
export const CUSTOMER_IMPORT_COLUMNS = [
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
] as const;

export type CustomerImportRowColumn =
  (typeof CUSTOMER_IMPORT_COLUMNS)[number] | 'unexpected_column';
export type CustomerImportRowErrorCode =
  | 'IMPORT_REQUIRED_CELL'
  | 'IMPORT_NAME_INVALID'
  | 'IMPORT_PHONE_INVALID'
  | 'IMPORT_COUNTRY_CODE_INVALID'
  | 'IMPORT_LOCALE_INVALID'
  | 'IMPORT_BOOLEAN_INVALID'
  | 'IMPORT_DATE_INVALID'
  | 'IMPORT_YEAR_KNOWN_REQUIRED'
  | 'IMPORT_GENDER_INVALID'
  | 'IMPORT_EMAIL_INVALID'
  | 'IMPORT_NOTE_INVALID'
  | 'IMPORT_CELL_INVALID'
  | 'IMPORT_COLUMN_UNEXPECTED'
  | 'IMPORT_DUPLICATE_IN_FILE';
export type CustomerImportWarningCode = 'EXISTING_NO_RATING_IGNORED';
export type CustomerImportRowStatus = 'new' | 'existing';
export type CustomerImportCell = string | number | boolean | null;
export type CustomerImportCommitDecision = 'request' | 'already_accepted';

/** رفض آمن لمعاينة استيراد العملاء؛ الكود وحده يعبر لطبقة الـ HTTP. */
export class CustomerImportError extends Error {
  /** يثبت سبب الرفض المسمّى قبل أي كتابة دون بيانات شخصية. @param code رمز الرفض */
  constructor(readonly code: CustomerImportErrorCode) {
    super(code);
    this.name = 'CustomerImportError';
  }
}

export interface CustomerImportRowIssue {
  readonly row: number;
  readonly column: CustomerImportRowColumn;
  readonly code: CustomerImportRowErrorCode;
}
export interface CustomerImportSheetRow {
  readonly row: number;
  readonly cells: readonly CustomerImportCell[];
}
export interface CustomerImportSheet {
  readonly matrix: readonly (readonly CustomerImportCell[])[] & {
    readonly sourceRows?: readonly number[];
  };
}
export interface CustomerImportBirthday {
  readonly day: number;
  readonly month: number;
  readonly year: number | null;
}
export interface CustomerImportCellValues {
  readonly yes: string;
  readonly no: string;
  readonly male: string;
  readonly female: string;
}
export interface CustomerImportCandidate {
  readonly row: number;
  readonly name: string;
  readonly phone: string | null;
  readonly masked_phone: string | null;
  readonly locale: 'ar' | 'en' | null;
  readonly no_rating: boolean;
  readonly birthday: CustomerImportBirthday | null;
  readonly gender: 'male' | 'female' | null;
  readonly email: string | null;
  readonly note: string | null;
  readonly errors: CustomerImportRowIssue[];
}
export interface CustomerImportRow {
  readonly row: number;
  readonly name: string;
  readonly phone: string;
  readonly masked_phone: string;
  readonly locale: 'ar' | 'en';
  readonly no_rating: boolean;
  readonly birthday: CustomerImportBirthday | null;
  readonly gender: 'male' | 'female' | null;
  readonly email: string | null;
  readonly note: string | null;
  readonly status: CustomerImportRowStatus;
  readonly warning: CustomerImportWarningCode | null;
}
export interface CustomerImportFileFacts {
  readonly business_id: string;
  readonly created_by: string;
  readonly owner_module: string;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly status: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
  readonly storage_key: string | null;
  readonly purged: boolean;
  readonly purge_started: boolean;
}
export interface CustomerImportCommitPreview {
  readonly id: string;
  readonly business_id: string;
  readonly created_by: string;
  readonly status: 'ready' | 'commit_requested' | 'committed' | 'failed';
  readonly expires_at: string;
  readonly error_count: number;
}

/**
 * يثبت ملكية الملف ووثوقه قبل قراءة بايتاته دون كشف الملفات الغريبة (073 D-2).
 *
 * @param facts      حقائق الملف أو null
 * @param businessId النشاط المستهدف
 * @param userId     منشئ المعاينة
 * @returns مفتاح التخزين الصالح
 */
export function validateCustomerImportFile(
  facts: CustomerImportFileFacts | null,
  businessId: string,
  userId: string,
): string {
  if (
    facts === null ||
    facts.purged ||
    facts.purge_started ||
    facts.owner_module !== CUSTOMER_IMPORT_OWNER_MODULE ||
    facts.business_id.toLowerCase() !== businessId.toLowerCase() ||
    facts.created_by.toLowerCase() !== userId.toLowerCase()
  )
    throw new CustomerImportError('IMPORT_FILE_NOT_FOUND');
  if (facts.status !== 'READY') throw new CustomerImportError('IMPORT_FILE_NOT_READY');
  if (facts.content_type !== CUSTOMER_IMPORT_CONTENT_TYPE)
    throw new CustomerImportError('IMPORT_FILE_TYPE_INVALID');
  if (
    !Number.isSafeInteger(facts.size_bytes) ||
    facts.size_bytes <= 0 ||
    facts.size_bytes > CUSTOMER_IMPORT_MAX_BYTES
  )
    throw new CustomerImportError('IMPORT_FILE_SIZE_INVALID');
  if (facts.storage_key === null) throw new CustomerImportError('IMPORT_FILE_NOT_FOUND');
  return facts.storage_key;
}

const CALLING_CODES: Readonly<Record<string, string>> = {
  KW: '965',
  SA: '966',
  AE: '971',
  BH: '973',
  QA: '974',
  OM: '968',
};

/**
 * كود الاتصال الافتراضي لدولة النشاط؛ غيابها يرفض المعاينة قبل قراءة الملف (CI-Q7، OQ-1).
 *
 * @param countryCode رمز الدولة أو null
 * @returns كود الاتصال الدولي
 */
export function customerImportCallingCode(countryCode: string | null): string {
  const callingCode =
    countryCode !== null && Object.hasOwn(CALLING_CODES, countryCode)
      ? CALLING_CODES[countryCode]
      : undefined;
  if (callingCode === undefined) throw new CustomerImportError('IMPORT_BUSINESS_COUNTRY_REQUIRED');
  return callingCode;
}

/**
 * يقرر قبول تثبيت المعاينة: الغريب مجهول، والمقبول مكرر، والمنتهي أو المعيب مرفوض (CIM-08).
 *
 * @param preview    المعاينة المقفلة
 * @param userId     المنشئ المتوقع
 * @param businessId النشاط المتوقع
 * @param now        ساعة الطلب المحقونة
 * @returns قرار القبول
 */
export function decideCustomerImportCommit(
  preview: CustomerImportCommitPreview,
  userId: string,
  businessId: string,
  now: Date,
): CustomerImportCommitDecision {
  if (
    preview.business_id.toLowerCase() !== businessId.toLowerCase() ||
    preview.created_by.toLowerCase() !== userId.toLowerCase()
  )
    throw new CustomerImportError('IMPORT_PREVIEW_NOT_FOUND');
  if (preview.status === 'commit_requested' || preview.status === 'committed')
    return 'already_accepted';
  if (preview.status === 'failed' || now.getTime() >= new Date(preview.expires_at).getTime())
    throw new CustomerImportError('IMPORT_PREVIEW_EXPIRED');
  if (preview.error_count > 0) throw new CustomerImportError('IMPORT_PREVIEW_HAS_ERRORS');
  return 'request';
}
