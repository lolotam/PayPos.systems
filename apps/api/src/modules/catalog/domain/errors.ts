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
