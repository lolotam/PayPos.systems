import { SessionError } from './session-error.ts';

const EDGE_WHITESPACE = ' \t\r\n';

/**
 * يطبّع سبب التعديل حتى يطابق قيد service_line_edits_reason قبل أي حفظ.
 * القص حلقة من الطرفين على المسافة والتاب وCR وLF فقط، لأن تعبيراً يفحص كل مسافة من كل بداية يعلّق الحلقة على نص طويل.
 * بعد القص يُرفض NUL والسروغيت اليتيم لأن نص PostgreSQL يرفضهما فيصير الرفض 500 داخل معاملة الكتابة.
 *
 * @param reason السبب كما وصل، وغيابه رفض لا فراغ مقبول
 * @returns السبب بعد قص الطرفين، من حرف إلى 500
 */
export function normalizeEditReason(reason: string | undefined): string {
  if (reason === undefined) throw new SessionError('SESSION_EDIT_REASON_INVALID');
  const normalized = trimEditReasonEdges(reason);
  if (hasRejectedPostgresText(normalized)) throw new SessionError('SESSION_EDIT_REASON_INVALID');
  const length = Array.from(normalized).length;
  if (length < 1 || length > 500) throw new SessionError('SESSION_EDIT_REASON_INVALID');
  return normalized;
}

function trimEditReasonEdges(reason: string): string {
  let start = 0;
  let end = reason.length;
  while (start < end && EDGE_WHITESPACE.includes(reason.charAt(start))) start += 1;
  while (end > start && EDGE_WHITESPACE.includes(reason.charAt(end - 1))) end -= 1;
  return reason.slice(start, end);
}

function hasRejectedPostgresText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return true;
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (code < 0xd800 || code > 0xdbff) continue;
    const next = value.charCodeAt(index + 1);
    if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    index += 1;
  }
  return false;
}
