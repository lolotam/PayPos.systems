import { notificationResult, RATING_REQUEST_TEMPLATE_KEY } from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';

import type { RecordRatingRequestSent } from '../../use-cases/record-rating-request-sent/record-rating-request-sent.ts';

/** هل الحمولة نتيجة واتساب ناجحة لقالب طلب التقييم؟ فحص خفيف يسبق التحقق الصارم، حتى لا تتعطل نتائج القوالب والقنوات التانية في هذا المستهلك. */
function isRatingAcceptance(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) return false;
  const fields = payload as Record<string, unknown>;
  return (
    fields['template_key'] === RATING_REQUEST_TEMPLATE_KEY &&
    fields['channel'] === 'whatsapp' &&
    fields['status'] === 'SENT'
  );
}

/**
 * يترجم قبول المزود لرسالة طلب التقييم عبر واتساب إلى انتقال SENT؛ كل نتيجة أخرى (قالب أو قناة أو حالة) يتجاهلها بصمت.
 * الحدث مربوط بالطلب بمعرّف حدث الجاهزية (`source_event_id`)، ونتيجة التقييم المشوهة أو الظرف المخالف للمحاولة والشركة يرمي خطأ.
 *
 * @param useCase خطوة تسجيل القبول
 * @param tx معاملة المستأجر
 * @param event حدث نتيجة الإشعار كما سلّمه المرسِل
 * @returns اكتمال المعالجة
 */
export async function onNotificationDelivered(
  useCase: RecordRatingRequestSent<Tx>,
  tx: Tx,
  event: ClaimedEvent,
): Promise<void> {
  if (!isRatingAcceptance(event.payload)) return;
  const parsed = notificationResult.safeParse(event.payload);
  if (
    !parsed.success ||
    event.aggregateType !== 'notification_attempt' ||
    parsed.data.attempt_id !== event.aggregateId ||
    parsed.data.company_id !== event.companyId
  )
    throw new Error('RATING_SENT_EVENT_INVALID');
  await useCase.execute(tx, {
    companyId: event.companyId,
    readyEventId: parsed.data.source_event_id,
    sentAt: new Date(parsed.data.occurred_at),
  });
}
