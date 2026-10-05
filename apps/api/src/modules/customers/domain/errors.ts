/** رقم العميل غير دولي؛ الخطأ لا يحتفظ بالمدخل لحماية الهاتف في الأخطاء والسجلات. */
export class InvalidCustomerPhoneError extends Error {
  /** لا نضيف الهاتف لرسالة الخطأ حتى لو التقطه سجل عام. */
  constructor() {
    super('INVALID_CUSTOMER_PHONE');
    this.name = 'InvalidCustomerPhoneError';
  }
}
