import { normalizeWrittenReason } from './written-reason.ts';

/**
 * يطبّع سبب تعديل السطر عبر القص المشترك حتى لا ينحرف عن قيد service_line_edits_reason.
 * الغياب والفراغ وNUL والسروغيت اليتيم والطول خارج 1..500 تبقى SESSION_EDIT_REASON_INVALID كما كانت.
 *
 * @param reason السبب كما وصل، وغيابه رفض لا فراغ مقبول
 * @returns السبب بعد قص الطرفين، من حرف إلى 500
 */
export function normalizeEditReason(reason: string | undefined): string {
  return normalizeWrittenReason(reason, 'SESSION_EDIT_REASON_INVALID');
}
