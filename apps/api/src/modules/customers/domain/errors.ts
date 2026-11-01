/** رقم العميل غير دولي؛ الخطأ لا يحتفظ بالمدخل لحماية الهاتف في الأخطاء والسجلات. */
export class InvalidCustomerPhoneError extends Error {
  /** لا نضيف الهاتف لرسالة الخطأ حتى لو التقطه سجل عام. */
  constructor() {
    super('INVALID_CUSTOMER_PHONE');
    this.name = 'InvalidCustomerPhoneError';
  }
}

/** بيانات الملف الشخصي غير صالحة؛ الخطأ لا يحتفظ بالقيمة عشان ما تتسربش في الأخطاء والسجلات. */
export class InvalidCustomerProfileError extends Error {
  /** لا نضيف تاريخ الميلاد ولا البريد ولا الملاحظة لرسالة الخطأ. */
  constructor() {
    super('INVALID_CUSTOMER_PROFILE');
    this.name = 'InvalidCustomerProfileError';
  }
}
