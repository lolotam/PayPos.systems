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
/** مقارنة بزمن ثابت حتى لا يتسرب طول البادئة الصحيحة عبر فرق المقارنة.
 *
 * @param expected الكود المخزّن
 * @param provided الكود الممسوح
 * @returns هل الكودان متطابقان بعد التطبيع
 */
export function cardCodeMatches(expected: string, provided: string): boolean {
  const a = normalizeCardCode(expected);
  const b = normalizeCardCode(provided);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}
/** الرفض يحمل الرمز الآمن فقط وتحوّله طبقة HTTP إلى مغلف ثنائي اللغة. */
export class EmployeeCardError extends Error {
  /** يحتفظ بالرمز فقط كي لا يتسرب سياق الشركة.
   *
   * @param code سبب الرفض
   */
  constructor(
    readonly code:
      | 'BAD_REQUEST'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'FEATURE_DISABLED'
      | 'EMPLOYEE_CARD_CODE_IN_USE',
  ) {
    super(code);
  }
}