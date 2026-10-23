import { notificationResult } from '@pospay/contracts';
import { appendOutboxEvent, type Tx } from '@pospay/db';

import type { PushTerminalResult } from '../domain/push-delivery.ts';

/** هوية المحاولة في حدث النتيجة: أرقام وبيانات 범خ بس، من غير أي سر من الاشتراك. */
export interface PushResultAttempt {
  readonly companyId: string;
  readonly id: string;
  readonly sourceEventId: string;
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly templateKey: string;
  readonly locale: 'ar' | 'en';
}

/**
 * يسجل نتيجة محاولة الدفع في الـ outbox.
 * القاعدة: الحدث فيه حالة النتيجة وسببها فقط؛ مفيش عنوان ولا مفتاح ولا رمز تسليم ولا نص إشعار.
 *
 * @param tx     معاملة الشركة
 * @param attempt هوية المحاولة
 * @param result النتيجة النهائية
 * @param eventId معرّف الحدث
 * @param now    وقت النتيجة
 */
export async function appendPushResult(
  tx: Tx,
  attempt: PushResultAttempt,
  result: PushTerminalResult,
  eventId: string,
  now: Date,
): Promise<void> {
  await appendOutboxEvent(tx, eventId, {
    aggregateType: 'push_attempt',
    aggregateId: attempt.id,
    eventType: result.status === 'SENT' ? 'NotificationDelivered' : 'NotificationFailed',
    payload: notificationResult.parse({
      company_id: attempt.companyId,
      attempt_id: attempt.id,
      source_event_id: attempt.sourceEventId,
      business_id: attempt.businessId,
      branch_id: attempt.branchId,
      channel: 'PUSH',
      template_key: attempt.templateKey,
      locale: attempt.locale,
      status: result.status,
      occurred_at: now.toISOString(),
      evidence: result.status === 'SENT' ? 'PROVIDER_ACCEPTED' : 'NONE',
      ...(result.failureCode === null ? {} : { failure_code: result.failureCode }),
      outcome_known: result.outcomeKnown,
    }),
  });
}
