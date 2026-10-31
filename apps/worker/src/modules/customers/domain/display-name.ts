/**
 * قواعد اسم العرض (ADR-0037 §4): يُرفض الرابط ورقم الهاتف والرمز المرقّم،
 * والسنة داخل الاسم مسموحة لأنها أربعة أرقام في كلمة لا رقم قائم بذاته.
 */
const DISPLAY_NAME_UNSAFE =
  /(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu;

/** أقصى طول لاسم العرض داخل الرسالة، وهو حد معامل الإشعار نفسه. */
const MAX_DISPLAY_NAME_LENGTH = 255;

/**
 * يقص الاسم الأول من اسم كامل ويرفض الأسماء غير الآمنة للعرض.
 *
 * @param value الاسم الكامل كما هو مخزّن، أو null
 * @returns الاسم الأول الآمن، أو null لما لا اسم صالح للعرض
 */
export function displaySafeFirstWord(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > MAX_DISPLAY_NAME_LENGTH) return null;
  if (DISPLAY_NAME_UNSAFE.test(trimmed)) return null;
  const [first = ''] = trimmed.split(/\s+/);
  if (first.length === 0 || first.length > MAX_DISPLAY_NAME_LENGTH) return null;
  if (DISPLAY_NAME_UNSAFE.test(first)) return null;
  return first;
}
