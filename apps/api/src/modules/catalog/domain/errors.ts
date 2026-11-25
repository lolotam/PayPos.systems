/**
 * رفض تعريف نوع الباقة أو تعديله. الكود فقط يصل للعميل، والرسالتان من packages/i18n.
 * الاسم المكرر قيد قاعدة بيانات لأن المقارنة تتجاهل حالة الحروف والمسافات (PT-Q8).
 */
export class PackageTypeError extends Error {
  /**
   * يثبت سبب الرفض المسمّى قبل أي كتابة.
   *
   * @param code سبب الرفض الآمن
   */
  constructor(
    readonly code:
      | 'PACKAGE_TYPE_NOT_FOUND'
      | 'PACKAGE_TYPE_INVALID_COMPONENTS'
      | 'PACKAGE_TYPE_DUPLICATE_SERVICE'
      | 'PACKAGE_TYPE_INVALID_SESSIONS'
      | 'PACKAGE_TYPE_PRICE_INVALID'
      | 'PACKAGE_TYPE_VALIDITY_INVALID'
      | 'PACKAGE_TYPE_SERVICE_NOT_FOUND'
      | 'PACKAGE_TYPE_NAME_TAKEN'
      | 'PACKAGE_TYPE_NAME_INVALID'
      | 'PACKAGE_TYPE_REVISION_CONFLICT'
      | 'PACKAGE_TYPE_SELLING_UNCHANGED'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
    this.name = 'PackageTypeError';
  }
}

/**
 * رفض آمن لعمليات الخدمة لا يحمل صفوف قاعدة البيانات ولا الأخطاء الخام للسائق.
 * الكود فقط بيعدّي للـ controller، والرسالتان العربي والإنجليزي من packages/i18n.
 */
export class ServiceError extends Error {
  /**
   * يبني رفضاً مسمّى يمكن تحويله لرسالة بلغتين دون كشف أي بيانات.
   *
   * @param code سبب الرفض الآمن
   */
  constructor(
    readonly code:
      | 'SERVICE_NOT_FOUND'
      | 'SERVICE_COMMISSION_RULE_INVALID'
      | 'SERVICE_PRICE_INVALID'
      | 'SERVICE_NAME_INVALID'
      | 'SERVICE_DURATION_INVALID'
      | 'SERVICE_CATEGORY_NOT_FOUND'
      | 'SERVICE_CATEGORY_CLOSED'
      | 'SERVICE_ALREADY_CLOSED'
      | 'SERVICE_NOT_CLOSED'
      | 'SERVICE_REVISION_CONFLICT'
      | 'FORBIDDEN'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
    this.name = 'ServiceError';
  }
}

/** رفض آمن لمعاينة استيراد الخدمات وتنزيل قالبها؛ الكود وحده يعبر لطبقة الـ HTTP برسالة بلغتين. */
export class ServiceImportError extends Error {
  /**
   * يثبت سبب الرفض المسمّى قبل أي كتابة، فلا يحمل الخطأ صفوفاً أو تفاصيل ملف خام.
   *
   * @param code سبب الرفض الآمن
   */
  constructor(
    readonly code:
      | 'IMPORT_FILE_NOT_FOUND'
      | 'IMPORT_FILE_NOT_READY'
      | 'IMPORT_FILE_TYPE_INVALID'
      | 'IMPORT_FILE_SIZE_INVALID'
      | 'IMPORT_FILE_CONTENT_INVALID'
      | 'IMPORT_HEADER_INVALID'
      | 'IMPORT_ROW_LIMIT_EXCEEDED'
      | 'IMPORT_TEMPLATE_EXCEEDS_LIMITS'
      | 'IMPORT_PREVIEW_NOT_FOUND'
      | 'IMPORT_PREVIEW_EXPIRED'
      | 'IMPORT_PREVIEW_HAS_ERRORS'
      | 'STORAGE_UNAVAILABLE'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
    this.name = 'ServiceImportError';
  }
}

/** رفض آمن لإنشاء تصنيف خدمة أو تعديله؛ الكود وحده يعبر لطبقة الـ HTTP. */
export class ServiceCategoryError extends Error {
  /**
   * يثبت سبب الرفض دون تسريب صف قاعدة البيانات أو خطأ السائق.
   *
   * @param code    سبب الرفض المسمّى
   * @param details تفاصيل الرفض الآمنة اللي بتوصل للعميل، زي هوية الطلب الشغّال
   */
  constructor(
    readonly code:
      | 'SERVICE_CATEGORY_NAME_INVALID'
      | 'SERVICE_CATEGORY_NAME_TAKEN'
      | 'SERVICE_CATEGORY_NOT_FOUND'
      | 'SERVICE_CATEGORY_CLOSED'
      | 'SERVICE_CATEGORY_ALREADY_CLOSED'
      | 'SERVICE_CATEGORY_NOT_CLOSED'
      | 'SERVICE_CATEGORY_COUNT_CHANGED'
      | 'SERVICE_CATEGORY_VISIBILITY_FIXED'
      | 'SERVICE_CATEGORY_REVISION_CONFLICT'
      | 'SERVICE_CATEGORY_CLOSING_IN_PROGRESS'
      | 'SERVICE_CATEGORY_CLOSING_NOT_FOUND'
      | 'TRANSACTION_RETRY_REQUIRED',
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ServiceCategoryError';
  }
}
