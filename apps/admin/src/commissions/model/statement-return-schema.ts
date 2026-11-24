import { commissionStatementReturnInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';

/** أقصى طول لسبب الإرجاع، زي ما السيرفر بيفحصه بعد القص (FR-031). */
export const RETURN_REASON_MAX = 500;

/** مفتاح رسالة الفحص اللي بيطلع تحت خانة السبب. */
export const RETURN_REASON_REQUIRED: MessageKey = 'commissionStatementScreen.returnReasonRequired';
export const RETURN_REASON_TOO_LONG: MessageKey = 'commissionStatementScreen.returnReasonTooLong';

/**
 * سكيما الفورم: جسم عقد الإرجاع نفسه، ومعاه الفحص اللي السيرفر هيطبّقه بعد القص (من غير تعديل الجسم المبعوت
 * لأن العقد ما بيقصش). الرسالة بتتخزن كمفتاح ويترجمه الفورم بلغة الشاشة.
 */
export const returnReasonForm = commissionStatementReturnInput.superRefine((value, context) => {
  const length = value.reason.trim().length;
  if (length === 0) context.addIssue({ code: 'custom', path: ['reason'], message: RETURN_REASON_REQUIRED });
  else if (length > RETURN_REASON_MAX)
    context.addIssue({ code: 'custom', path: ['reason'], message: RETURN_REASON_TOO_LONG });
});
