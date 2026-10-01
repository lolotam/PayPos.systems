import { notificationRequest, type InAppRecipient } from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';
import type { createPhoneIdentity, createTemplateRegistry } from '@pospay/notifications';

import type { OutboxConsumer } from '../../../../outbox/consumer.ts';
import type { AuthorizeNotification } from '../../use-cases/authorize-notification/authorize-notification.ts';
import type { StoreInAppNotification } from '../../use-cases/store-in-app-notification/store-in-app-notification.ts';
import { validInAppTemplate } from '@pospay/notifications';

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
  store: (tx: Tx) => StoreInAppNotification,
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
        if (recipient.channel === 'IN_APP') {
          await storeRecipient(store(tx), event, recipient, parsed.data);
          continue;
        }
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

function storeRecipient(
  store: StoreInAppNotification,
  event: ClaimedEvent,
  recipient: InAppRecipient,
  scope: { business_id?: string | null | undefined; branch_id?: string | null | undefined },
) {
  if (
    !validInAppTemplate(
      recipient.template_key,
      recipient.template_revision,
      recipient.locale,
      recipient.safe_parameters,
    )
  )
    throw new Error('NOTIFICATION_REQUEST_INVALID');
  return store.execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    recipientUserId: recipient.user_id,
    businessId: scope.business_id ?? null,
    branchId: scope.branch_id ?? null,
    templateKey: recipient.template_key,
    templateRevision: recipient.template_revision,
    locale: recipient.locale,
    safeParameters: recipient.safe_parameters,
  });
}
