import { notificationRequest } from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';
import type { createPhoneIdentity, createTemplateRegistry } from '@pospay/notifications';

import type { OutboxConsumer } from '../../../../outbox/consumer.ts';
import type { AuthorizeNotification } from '../../use-cases/authorize-notification/authorize-notification.ts';

export const NOTIFICATION_SOURCE_EVENTS = [
  'PaymentFailed',
  'CashShiftClosed',
  'AppointmentBooked',
  'StockPosted',
  'DeviceRegistered',
  'DeviceRevoked',
  'GatewayAccountConnected',
  'DocumentReady',
  'RatingRequestReady',
  'LowRatingReceived',
  'AttendanceExceptionRaised',
  'ShiftNotClockedIn',
  'DocumentExpiring',
  'StatementAwaitingReview',
  'StatementAwaitingApproval',
] as const;

export function notificationRequestConsumer(
  authorize: (tx: Tx) => AuthorizeNotification,
  identity: ReturnType<typeof createPhoneIdentity>,
  registry: ReturnType<typeof createTemplateRegistry>,
): OutboxConsumer {
  return {
    id: 'notifications.authorize-v1',
    eventTypes: NOTIFICATION_SOURCE_EVENTS,
    handle: async (tx, event: ClaimedEvent) => {
      const parsed = notificationRequest.safeParse(event.payload);
      if (!parsed.success) {
        // Producers without notification recipients have no request for this consumer.
        if (
          typeof event.payload === 'object' &&
          event.payload !== null &&
          !('notification_recipients' in event.payload)
        )
          return;
        throw new Error('NOTIFICATION_REQUEST_INVALID');
      }
      for (const recipient of parsed.data.notification_recipients) {
        const locale = recipient.locale ?? null;
        const prepared =
          locale === 'ar' || locale === 'en'
            ? registry.prepare(
                recipient.template_key,
                recipient.template_revision,
                locale,
                recipient.safe_parameters,
              )
            : null;
        await authorize(tx).execute({
          companyId: event.companyId,
          sourceEventId: event.id,
          businessId: parsed.data.business_id ?? null,
          branchId: parsed.data.branch_id ?? null,
          phone: recipient.phone,
          identity: identity.identify(recipient.phone),
          locale,
          channel: recipient.channel,
          templateKey: recipient.template_key,
          templateRevision: recipient.template_revision,
          providerTemplateName: prepared?.valid === true ? prepared.name : null,
          safeParameters: prepared?.valid === true ? recipient.safe_parameters : [],
          deadline: recipient.send_deadline == null ? null : new Date(recipient.send_deadline),
          configurationFailure: prepared?.valid === false ? prepared.code : null,
        });
      }
    },
  };
}
