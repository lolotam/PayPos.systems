const UNSAFE_NAME =
  /(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu;

/**
 * يقبل الاسم المخزن للعرض فقط إذا كان آمنًا: غير فارغ، لا يتجاوز 255 حرفًا، ولا يشبه رابطًا أو هاتفًا أو رمزًا.
 * الاسم المرفوض لا يُعرض أبدًا لأنه يصل إلى إشعارات المستلمين دون مراجعة بشرية.
 *
 * @param value الاسم كما خُزن (قد يكون فارغًا)
 * @returns الاسم بعد قص الفراغ، أو null إذا لم يصلح للعرض
 */
export function safeDisplayName(value: string | null | undefined): string | null {
  const name = value?.trim() ?? '';
  return name.length > 0 && name.length <= 255 && !UNSAFE_NAME.test(name) ? name : null;
}
