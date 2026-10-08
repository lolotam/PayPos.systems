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
      | 'SERVICE_REVISION_CONFLICT'
      | 'FORBIDDEN'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
    this.name = 'ServiceError';
  }
}
