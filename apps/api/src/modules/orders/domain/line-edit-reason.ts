import { SessionError } from './session-error.ts';

/**
 * يطبّع سبب التعديل حتى يطابق قيد service_line_edits_reason قبل أي حفظ.
 * القص يقتصر على المسافة والتاب وCR وLF، والطول بنقاط يونيكود، لأن إيموجي من أربع بايتات حرف واحد.
 *
 * @param reason السبب كما وصل، وغيابه رفض لا فراغ مقبول
 * @returns السبب بعد قص الطرفين، من حرف إلى 500
 */
export function normalizeEditReason(reason: string | undefined): string {
  if (reason === undefined) throw new SessionError('SESSION_EDIT_REASON_INVALID');
  const normalized = reason.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  const length = Array.from(normalized).length;
  if (length < 1 || length > 500) throw new SessionError('SESSION_EDIT_REASON_INVALID');
  return normalized;
}
