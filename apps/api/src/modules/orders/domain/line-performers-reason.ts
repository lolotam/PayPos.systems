import { normalizeWrittenReason } from './written-reason.ts';

/**
 * يطبّع سبب تغيير المنفّذين عبر القص المشترك حتى يطابق قيد قاعدة البيانات ولا ينحرف عن سبب التعديل والإلغاء.
 * الغياب والفراغ يصلان من العقد عمداً حتى يكون الرفض 422 لا 400.
 *
 * @param reason السبب كما وصل، وغيابه رفض
 * @returns السبب بعد قص المسافة والتاب وCR وLF، من حرف إلى 500
 */
export function normalizePerformersReason(reason: string | undefined): string {
  return normalizeWrittenReason(reason, 'SESSION_PERFORMERS_REASON_INVALID');
}
