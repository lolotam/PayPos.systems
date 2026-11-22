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

/**
 * يقبل اسمًا كاملًا للعرض بحد بوحدات الـ code point، ويرفض الرابط ورقم الهاتف والرمز المرقّم.
 * الحد بالـ code point مثل حدود الجدول، فاسم إيموجي مسموح في القاعدة ما يترفضش في الجرس.
 *
 * @param value الاسم كما هو مخزّن، أو null
 * @param maxCodePoints أقصى عدد code points للحقل (حد عمود الجدول)
 * @returns الاسم بعد قص الفراغ، أو null لما لا اسم صالح للعرض
 */
export function displaySafeName(value: string | null, maxCodePoints: number): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0 || Array.from(trimmed).length > maxCodePoints) return null;
  return DISPLAY_NAME_UNSAFE.test(trimmed) ? null : trimmed;
}
