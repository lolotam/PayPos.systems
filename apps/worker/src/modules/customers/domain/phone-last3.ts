/**
 * يرجع آخر ثلاثة أرقام من هاتف E.164 بنفس دلالة `maskPhone` في API العملاء:
 * يحذف علامة الجمع ثم يقص آخر ثلاثة، فالرقم الأقصر (رقمان قانونيان) يرجع كما هو بلا حشو.
 * الهاتف الكامل لا يخرج من هذه الدالة أبدًا (S-12، RT-23).
 *
 * @param phone هاتف العميل المخزّن بصيغة E.164
 * @returns رقمان أو ثلاثة أرقام من آخر الهاتف
 */
export function phoneLast3(phone: string): string {
  if (!/^\+[1-9][0-9]{1,14}(?![\s\S])/.test(phone)) throw new Error('LOW_RATING_PHONE_INVALID');
  return phone.slice(1).slice(-3);
}
