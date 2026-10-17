import { SessionError, type SessionErrorCode } from './session-error.ts';

const EDGE_WHITESPACE = ' \t\r\n';

/**
 * يطبّع سبباً مكتوباً قبل الحفظ حتى يطابق قص قاعدة البيانات ويرفض نص PostgreSQL الذي ينقلب إلى 500.
 * القص على المسافة والتاب وCR وLF فقط، لأن تعبيراً يفحص كل مسافة من كل بداية يعلّق الحلقة على نص طويل.
 * المستدعي يمرّر رمز الرفض حتى يبقى سبب تعديل السطر وسبب البقشيش قاعدتين على نفس القص.
 *
 * @param reason النص كما وصل، وغيابه رفض بالرمز المعطى
 * @param code رمز الرفض حين يغيب النص أو يخرج عن 1..500 أو يحمل NUL أو سروغيتاً يتيماً
 * @returns النص بعد قص الطرفين، من حرف إلى 500
 */
export function normalizeWrittenReason(reason: string | undefined, code: SessionErrorCode): string {
  if (reason === undefined) throw new SessionError(code);
  const normalized = trimWrittenReasonEdges(reason);
  if (hasRejectedPostgresText(normalized)) throw new SessionError(code);
  const length = Array.from(normalized).length;
  if (length < 1 || length > 500) throw new SessionError(code);
  return normalized;
}

/**
 * يقرر سبب مراجعة البقشيش: أول إدخال بلا سبب مقبول، والاستبدال يحتاج سبباً مكتوباً.
 * تُستدعى بعد assertTipRevision، لأن الطلب المتأخر يُرفض بـ TIP_REVISION_CONFLICT لا بـ TIP_REASON_REQUIRED.
 * الفراغ بعد القص عند مراجعة قائمة هو TIP_REASON_REQUIRED، والنص المعطوب VALIDATION_FAILED حتى يرد النطاق 422.
 *
 * @param currentRevision رقم المراجعة المحفوظ الآن، وصفر يعني أنه لا بقشيش بعد
 * @param reason السبب كما وصل، وقد يغيب في أول إدخال
 * @returns السبب بعد القص، أو null حين لا توجد مراجعة سابقة ولا سبب
 */
export function tipReasonFor(currentRevision: number, reason: string | undefined): string | null {
  if (reason === undefined || trimWrittenReasonEdges(reason).length === 0) {
    if (currentRevision >= 1) throw new SessionError('TIP_REASON_REQUIRED');
    return null;
  }
  return normalizeWrittenReason(reason, 'VALIDATION_FAILED');
}

function trimWrittenReasonEdges(reason: string): string {
  let start = 0;
  let end = reason.length;
  while (start < end && EDGE_WHITESPACE.includes(reason.charAt(start))) start += 1;
  while (end > start && EDGE_WHITESPACE.includes(reason.charAt(end - 1))) end -= 1;
  return reason.slice(start, end);
}

function hasRejectedPostgresText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) return true;
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
    if (unit < 0xd800 || unit > 0xdbff) continue;
    const next = value.charCodeAt(index + 1);
    if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    index += 1;
  }
  return false;
}
