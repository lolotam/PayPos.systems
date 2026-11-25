import { ServiceImportError } from './errors.ts';

/**
 * حدّ مصنف خدمات الاستيراد (ADR-0034 addendum §3): حجم الملف وعدد صفوف البيانات والأعمدة.
 * حد `maxWorksheets` ما بيتحددش هنا لأنه بيعتمد على أوراق القالب المرجعية، وهو شغل 32b-2.
 */
export const SERVICE_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const SERVICE_IMPORT_MAX_DATA_ROWS = 500;
export const SERVICE_IMPORT_MAX_COLUMNS = 10;

/** عمود استيراد الخدمات كما يظهر في أخطاء الصف؛ `unexpected_column` للبيانات بعد آخر عنوان. */
export type ServiceImportRowColumn =
  | 'name_en'
  | 'name_ar'
  | 'price'
  | 'duration_minutes'
  | 'category'
  | 'commission_rule'
  | 'commission_value'
  | 'counts_toward_threshold'
  | 'unexpected_column';

/** رمز خطأ الصف كما تعرفه مواصفة 072؛ العقد والنطاق بنفس الحروف بالظبط. */
export type ServiceImportRowErrorCode =
  | 'IMPORT_REQUIRED_CELL'
  | 'IMPORT_NAME_INVALID'
  | 'IMPORT_PRICE_INVALID'
  | 'IMPORT_COMMISSION_RULE_INVALID'
  | 'IMPORT_COMMISSION_VALUE_INVALID'
  | 'IMPORT_BOOLEAN_INVALID'
  | 'IMPORT_DURATION_INVALID'
  | 'IMPORT_CATEGORY_NOT_FOUND'
  | 'IMPORT_CELL_INVALID'
  | 'IMPORT_COLUMN_UNEXPECTED'
  | 'IMPORT_DUPLICATE_IN_FILE'
  | 'IMPORT_SERVICE_EXISTS';

/** العناوين الستة الإجبارية بترتيبها المرجعي (FR-001). */
export const SERVICE_IMPORT_REQUIRED_HEADERS = [
  'name_en',
  'name_ar',
  'price',
  'commission_rule',
  'commission_value',
  'counts_toward_threshold',
] as const;

/** العمودان الاختياريان: عنوانهما الغائب يعني «بلا قيمة» لكل الصفوف (SI-Q6 إلى SI-Q8). */
export const SERVICE_IMPORT_OPTIONAL_HEADERS = ['duration_minutes', 'category'] as const;

/**
 * بيختار مجموعة العناوين المتوقعة من نصوص صف العناوين كما وردت في المصنف، بنفس تشذيب `readSheet`
 * (`String(cell).trim()`): الستة الإجبارية دايماً، وكل عمود اختياري موجود بينها بيتضاف.
 * `readSheet` نفسه هو اللي بيرفض العنوان الناقص أو الزائد أو المكرر بـ `IMPORT_HEADER_INVALID`،
 * فالدالة دي بتحدد المجموعة المتوقعة بس وما بتتحققش منها بنفسها.
 *
 * @param headerTexts نصوص خلايا صف العناوين كما وردت، قبل أي تشذيب
 * @returns قائمة العناوين المتوقعة للاستيراد
 */
export function serviceImportExpectedHeaders(headerTexts: readonly unknown[]): string[] {
  const trimmed = headerTexts.map((header) => String(header ?? '').trim());
  const optional = SERVICE_IMPORT_OPTIONAL_HEADERS.filter((header) => trimmed.includes(header));
  return [...SERVICE_IMPORT_REQUIRED_HEADERS, ...optional];
}

/**
 * لحظة قبول واحدة تربط صلاحية المعاينة بالطلب المحفوظ؛ المساواة منتهية مثل قاعدة الموظف.
 *
 * @param expiresAt انتهاء المعاينة المحفوظ
 * @param requestedAt لحظة قبول الطلب من الساعة المحقونة
 * @returns لا شيء عند القبول قبل الانتهاء، وإلا رفض انتهاء مسمى
 */
export function requireServiceImportRequestExpiry(expiresAt: string, requestedAt: Date): void {
  if (new Date(expiresAt).getTime() <= requestedAt.getTime())
    throw new ServiceImportError('IMPORT_PREVIEW_EXPIRED');
}
