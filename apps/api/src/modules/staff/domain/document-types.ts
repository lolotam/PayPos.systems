/** رفض وثائق الموظفين بأكواد ثابتة لا تحمل اسم ملف أو مفتاحاً قد يصل للسجلات. */
export class DocumentError extends Error {
  /**
   * سبب مسمى يترجمه الـ API إلى رسالة باللغتين.
   *
   * @param code رمز الرفض
   */
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'FEATURE_DISABLED'
      | 'TRANSACTION_RETRY_REQUIRED'
      | 'FILE_NOT_READY'
      | 'DOCUMENT_TYPE_UNAVAILABLE'
      | 'DOCUMENT_EXPIRY_REQUIRED'
      | 'DOCUMENT_FILE_ALREADY_RECORDED'
      | 'DOCUMENT_FILE_TYPE_INVALID'
      | 'DOCUMENT_TYPE_REVISION_CONFLICT'
      | 'DOCUMENT_TYPE_LIMIT_REACHED',
  ) {
    super(code);
  }
}

/** نوع وثيقة على مستوى الشركة؛ الكود ثابت والاسم والتنبيه قابلان للتعديل. */
export type DocumentTypeRecord = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string | null;
  alert_days: number;
  requires_expiry: boolean;
  active: boolean;
  revision: number;
};

/** الحقول التي يملك المدير تعديلها في النوع. */
export interface DocumentTypeTerms {
  name_en: string;
  name_ar?: string | null | undefined;
  alert_days: number;
  requires_expiry: boolean;
}

// قرار المالك 2026-10-04 (DOC-Q6، الخيار الموصى به): سقف مئة نوع لكل شركة يبقي القائمة كاملة بلا ترقيم إلى أن يقرر المالك غيره.
export const DOCUMENT_TYPE_LIMIT = 100;
const MAX_REVISION = 2147483647;

function cleanName(value: string | null | undefined, required: boolean): string | null {
  const name = value?.trim() ?? '';
  if (name === '') {
    if (required) throw new DocumentError('VALIDATION_FAILED');
    return null;
  }
  if (name.length > 255) throw new DocumentError('VALIDATION_FAILED');
  return name;
}

/**
 * ينظف شروط النوع: الاسم الإنجليزي إلزامي والعربي اختياري، والتنبيه من صفر إلى سنة.
 *
 * @param terms الحقول القادمة من العقد
 * @returns الشروط بعد التشذيب، والاسم العربي الفارغ يصبح null
 */
export function validateDocumentTypeTerms(terms: DocumentTypeTerms) {
  if (!Number.isInteger(terms.alert_days) || terms.alert_days < 0 || terms.alert_days > 365)
    throw new DocumentError('VALIDATION_FAILED');
  return {
    name_en: cleanName(terms.name_en, true) as string,
    name_ar: cleanName(terms.name_ar, false),
    alert_days: terms.alert_days,
    requires_expiry: terms.requires_expiry,
  };
}

/**
 * كود النوع المضاف يشتق من معرفه، فلا يحتاج المدير لكتابة كود ولا يتصادم كودان داخل الشركة.
 *
 * @param id معرف UUID v7 المحقون للنوع الجديد
 * @returns كود ثابت بصيغة custom_<32 hex>
 */
export function customDocumentTypeCode(id: string): string {
  const hex = id.toLowerCase().replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new DocumentError('VALIDATION_FAILED');
  return `custom_${hex}`;
}

/**
 * يبني نوعاً جديداً مفعلاً في نسخته الأولى بعد التحقق من سقف الأنواع في الشركة.
 *
 * @param id معرف النوع المحقون
 * @param terms شروط المدير
 * @param existingCount عدد أنواع الشركة الحالية، المفعلة والموقوفة
 * @returns سجل النوع الجديد
 */
export function newDocumentType(
  id: string,
  terms: DocumentTypeTerms,
  existingCount: number,
): DocumentTypeRecord {
  if (existingCount >= DOCUMENT_TYPE_LIMIT) throw new DocumentError('DOCUMENT_TYPE_LIMIT_REACHED');
  return {
    id,
    code: customDocumentTypeCode(id),
    ...validateDocumentTypeTerms(terms),
    active: true,
    revision: 1,
  };
}

function nextRevision(before: DocumentTypeRecord, expectedRevision: number): number {
  if (before.revision !== expectedRevision)
    throw new DocumentError('DOCUMENT_TYPE_REVISION_CONFLICT');
  if (before.revision >= MAX_REVISION) throw new DocumentError('VALIDATION_FAILED');
  return before.revision + 1;
}

/**
 * يعدل الاسم والتنبيه وقاعدة الانتهاء عند النسخة المتوقعة؛ الكود والتفعيل لا يتغيران هنا.
 *
 * @param before النوع المقفول
 * @param terms الشروط الجديدة
 * @param expectedRevision النسخة التي رآها المدير
 * @returns النسخة التالية من النوع
 */
export function reviseDocumentType(
  before: DocumentTypeRecord,
  terms: DocumentTypeTerms,
  expectedRevision: number,
): DocumentTypeRecord {
  const revision = nextRevision(before, expectedRevision);
  return { ...before, ...validateDocumentTypeTerms(terms), revision };
}

/**
 * يوقف النوع أو يعيد تفعيله دون حذف؛ الوثائق المسجلة تحتفظ بنوعها في الحالتين.
 *
 * @param before النوع المقفول
 * @param active الحالة المطلوبة
 * @param expectedRevision النسخة التي رآها المدير
 * @returns النسخة التالية من النوع
 */
export function setDocumentTypeActive(
  before: DocumentTypeRecord,
  active: boolean,
  expectedRevision: number,
): DocumentTypeRecord {
  return { ...before, active, revision: nextRevision(before, expectedRevision) };
}
