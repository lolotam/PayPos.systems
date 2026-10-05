/** يوحّد الكود قبل التخزين والمقارنة؛ المسافة الطرفية تأتي من ماسح لوحة المفاتيح.
 *
 * @param raw الكود كما كتبه الماسح أو المدير
 * @returns الكود بعد تقليم الفراغات الطرفية فقط، دون تغيير الحالة
 */
export function normalizeCardCode(raw: string): string {
  return raw.trim();
}
/** الكود شبه سرّي: نحدد الطول ومجموعة الطباعة الأحادية للبايت لمنع أي محتوى غريب.
 *
 * @param code الكود بعد التطبيع
 * @returns صالح للتخزين والمقارنة
 */
export function validCardCode(code: string): boolean {
  return code.length >= 4 && code.length <= 64 && /^[\x21-\x7e]+$/.test(code);
}
/** اللاحقة للتعرّف على الكارت فقط؛ حتى الكود القصير لا يُعرض كاملاً.
 *
 * @param code الكود المطبّع
 * @returns آخر أربعة أحرف بحد أقصى، مع إخفاء حرف واحد على الأقل
 */
export function cardDisplaySuffix(code: string): string {
  return code.slice(-Math.min(4, Math.max(0, code.length - 1)));
}
/** الرفض يحمل الرمز الآمن فقط وتحوّله طبقة HTTP إلى مغلف ثنائي اللغة. */
export class EmployeeCardError extends Error {
  /** يحتفظ بالرمز فقط كي لا يتسرب سياق الشركة.
   *
   * @param code سبب الرفض
   */
  constructor(
    readonly code:
      'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'FEATURE_DISABLED' | 'EMPLOYEE_CARD_CODE_IN_USE',
  ) {
    super(code);
  }
}
