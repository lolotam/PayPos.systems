import { normalizeWrittenReason } from './written-reason.ts';

/**
 * يطبّع سبب الإلغاء عبر القص المشترك حتى يطابق قيد slc_reason_ck ولا ينحرف عن سبب التعديل والبقشيش.
 * الغياب والفراغ يصلان من العقد عمداً حتى يكون الرفض 422 لا 400.
 *
 * @param reason السبب كما وصل، وغيابه رفض
 * @returns السبب بعد قص المسافة والتاب وCR وLF، من حرف إلى 500
 */
export function normalizeCancelReason(reason: string | undefined): string {
  return normalizeWrittenReason(reason, 'SESSION_CANCEL_REASON_INVALID');
}
