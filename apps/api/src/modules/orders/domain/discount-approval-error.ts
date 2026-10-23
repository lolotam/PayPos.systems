/**
 * أسباب رفض طلب الموافقة؛ كل sub-PR لاحق يضيف كوده هنا.
 * الأكواد تسمّى برفض قاعدي لا بخطأ سائق ولا ببيانات عميلة.
 */
export type DiscountApprovalErrorCode = 'DISCOUNT_APPROVAL_NOT_NEEDED';

/** الرفض المسمّى لطلب الموافقة؛ طبقة HTTP تحدد الحالة والترجمة (CLAUDE.md §6). */
export class DiscountApprovalError extends Error {
  /**
   * يثبت سبب الرفض وتفاصيل البنود التي لا تحتاج موافقة.
   *
   * @param code سبب الرفض
   * @param details مواضع البنود التي لا تحتاج موافقة، بالسطر صفرّي داخل الطلب
   */
  constructor(readonly code: DiscountApprovalErrorCode, readonly details?: unknown) { super(code); }
}
