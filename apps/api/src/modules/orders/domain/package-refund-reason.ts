import { PackageRefundError } from './package-refund-error.ts';
import { SessionError } from './session-error.ts';
import { normalizeWrittenReason } from './written-reason.ts';

/**
 * يطبّع سبب الاسترداد بنفس قص أسباب الإلغاء والتعديل، حتى يطابق قيد عمود الاسترداد ولا تتشعب القواعد.
 * السبب الفارغ أو الأطول من 500 حرف أو النص المعطوب يرفض برمز الاسترداد نفسه 422، لا برمز التحقق العام 400،
 * لأن جسم الطلب سليم والقاعدة هي التي رفضته.
 *
 * @param reason السبب كما وصل من الطلب، وقد يغيب
 * @returns السبب بعد قص الطرفين، من حرف إلى 500
 */
export function normalizeRefundReason(reason: string | undefined): string {
  try {
    return normalizeWrittenReason(reason, 'VALIDATION_FAILED');
  } catch (error) {
    if (error instanceof SessionError) {
      throw new PackageRefundError('PACKAGE_REFUND_REASON_INVALID');
    }
    throw error;
  }
}
