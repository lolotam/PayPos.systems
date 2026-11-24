import { appendOutboxEvent, type Tx } from '@pospay/db';

import type { IdGenerator } from '../ports/commission-line-projection.port.ts';
import type { ParkedAlertNotifier } from '../ports/parked-commission-alert.port.ts';

/**
 * كاتب جرس الحدث الموقوف: الـaggregate بتاعه خاص بيه عشان الصف الموقوف ما يحجبش
 * جرسه، والجرس بيحمل نوع الحدث ورقمه المرجعي وبلا حمولة ولا بيانات عميل.
 *
 * @param ids مولّد هوية الحدث المحقون
 * @param parsePayload مدقّق الحمولة المربوط من جذر التركيب
 * @returns كاتب الجرس
 */
export function createParkedCommissionAlertNotifier(
  ids: IdGenerator,
  parsePayload: (payload: unknown) => unknown,
): ParkedAlertNotifier<Tx> {
  return async (tx, notice) => {
    const eventId = notice.eventId.toLowerCase();
    await appendOutboxEvent(tx, ids.newId(), {
      aggregateType: 'commission_parked_event',
      aggregateId: notice.eventId,
      eventType: 'CommissionEventParkedNoticeRequested',
      payload: parsePayload({
        schema_version: 1,
        event_id: eventId,
        event_type: notice.eventType,
        group_index: notice.groupIndex,
        notification_recipients: notice.recipients.map((userId) => ({
          channel: 'IN_APP',
          user_id: userId,
          locale: 'ar',
          template_key: 'commission_event_parked',
          template_revision: 1,
          safe_parameters: [
            { name: 'event_type', type: 'text', value: notice.eventType },
            { name: 'event_id', type: 'text', value: eventId },
          ],
        })),
      }),
    });
  };
}
