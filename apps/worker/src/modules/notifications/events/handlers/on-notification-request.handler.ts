import {
  notificationRequest,
  type InAppRecipient,
  type NotificationRecipient,
  type PushRecipient,
} from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';
import type { createPhoneIdentity, createTemplateRegistry } from '@pospay/notifications';

import type { OutboxConsumer } from '../../../../outbox/consumer.ts';
import type { AuthorizeNotification } from '../../use-cases/authorize-notification/authorize-notification.ts';
import type { StoreInAppNotification } from '../../use-cases/store-in-app-notification/store-in-app-notification.ts';
import type { StorePushAttempts } from '../../use-cases/store-push-attempts/store-push-attempts.ts';
import { validInAppTemplate, validPushTemplate } from '@pospay/notifications';
type EmailRecipient = Extract<NotificationRecipient, { channel: 'email' }>;
type EmailScope = {
  business_id?: string | null | undefined;
  branch_id?: string | null | undefined;
};
/** مستلم القناة المجدولة: الهاتف أو البريد؛ المستلمون التانية بيتعاملوا معاهم في فرع التاني. */
type ScheduledRecipient = Extract<NotificationRecipient, { channel: 'whatsapp' | 'email' }>;
type EmailAuthorizer = (
  tx: Tx,
  event: ClaimedEvent,
  recipient: EmailRecipient,
  scope: EmailScope,
) => Promise<void>;
/** تبعيات التفويض: التفويض نفسه، وهوية الهاتف، وسجل القوالب، ومؤلف البريد لو اتظبط. */
type AuthorizeDependencies = {
  readonly authorize: (tx: Tx) => AuthorizeNotification;
  readonly identity: Pick<ReturnType<typeof createPhoneIdentity>, 'identify'>;
  readonly registry: ReturnType<typeof createTemplateRegistry>;
  readonly email: EmailAuthorizer | undefined;
};
/** طلب تفويض واحد: المعاملة والحدث والمستلم والنطاق اللي جاي في الطلب. */
type RecipientRequest = {
  readonly tx: Tx;
  readonly event: ClaimedEvent;
  readonly recipient: ScheduledRecipient;
  readonly scope: EmailScope;
};
/** تخزين الدفع في المستهلك: التفعيل بيقول إن المرسل جاهز، والتخزين بيرجّع محاولة لكل اشتراك حيّ. */
type PushStore = {
  readonly enabled: boolean;
  readonly store: (tx: Tx) => StorePushAttempts;
};

export const NOTIFICATION_SOURCE_EVENTS = [
  'LateServiceSessionNoticeRequested',
  'ServiceLineEditNoticeRequested',
  'ServiceLineCancelNoticeRequested',
  'ServiceLinePerformersNoticeRequested',
  'DiscountApprovalNoticeRequested',
  'DiscountSelfApprovalNoticeRequested',
  'AttendanceChangeRequested',
  'AttendanceChangeDecided',
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
  'ShiftBreakNotReturned',
  'DocumentExpiring',
  'StatementAwaitingReview',
  'StatementAwaitingApproval',
] as const;

export function notificationRequestConsumer(
  authorize: (tx: Tx) => AuthorizeNotification,
  identity: Pick<ReturnType<typeof createPhoneIdentity>, 'identify'>,
  registry: ReturnType<typeof createTemplateRegistry>,
  store: (tx: Tx) => StoreInAppNotification,
  email?: EmailAuthorizer,
  push?: PushStore,
): OutboxConsumer {
  return {
    id: 'notifications.authorize-v1',
    eventTypes: NOTIFICATION_SOURCE_EVENTS,
    handle: async (tx, event: ClaimedEvent) => {
      const parsed = parseRequest(event);
      if (!parsed.success) return;
      const dependencies: AuthorizeDependencies = { authorize, identity, registry, email };
      for (const recipient of parsed.data.notification_recipients) {
        if (recipient.channel === 'IN_APP') {
          await storeRecipient(store(tx), event, recipient, parsed.data);
          continue;
        }
        if (recipient.channel === 'PUSH') {
          await storePushRecipient(push, tx, event, recipient, parsed.data);
          continue;
        }
        await authorizeRecipient(dependencies, {
          tx,
          event,
          recipient,
          scope: parsed.data,
        });
      }
    },
  };
}

// مسار التفويض: البريد أو واتساب؛ القالب بيتأكد والوجهة بتتسجل في معاملة المصدر.
async function authorizeRecipient(
  dependencies: AuthorizeDependencies,
  request: RecipientRequest,
): Promise<void> {
  const { tx, event, recipient, scope } = request;
  if (recipient.channel === 'email') {
    if (dependencies.email === undefined) throw new Error('EMAIL_DISABLED');
    await dependencies.email(tx, event, recipient, scope);
    return;
  }
  const locale = recipient.locale ?? null;
  const prepared =
    locale === 'ar' || locale === 'en'
      ? dependencies.registry.prepare(
          recipient.template_key,
          recipient.template_revision,
          locale,
          recipient.safe_parameters,
        )
      : null;
  await dependencies.authorize(tx).execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    businessId: scope.business_id ?? null,
    branchId: scope.branch_id ?? null,
    phone: recipient.phone,
    identity: dependencies.identity.identify(recipient.phone),
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

function parseRequest(event: ClaimedEvent) {
  const parsed = notificationRequest.safeParse(event.payload);
  if (
    !parsed.success &&
    !(
      typeof event.payload === 'object' &&
      event.payload !== null &&
      !('notification_recipients' in event.payload)
    )
  )
    throw new Error('NOTIFICATION_REQUEST_INVALID');
  return parsed;
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

// مسار الدفع: القالب بيتأكد قبل أي كتابة، والمرسل غير المهيّأ بيسيب الطلب عادي من غير خطأ.
async function storePushRecipient(
  push: PushStore | undefined,
  tx: Tx,
  event: ClaimedEvent,
  recipient: PushRecipient,
  scope: EmailScope,
): Promise<void> {
  if (
    !validPushTemplate(
      recipient.template_key,
      recipient.template_revision,
      recipient.safe_parameters,
    )
  )
    throw new Error('NOTIFICATION_REQUEST_INVALID');
  if (push === undefined || !push.enabled) return;
  await push.store(tx).execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    userId: recipient.user_id,
    businessId: scope.business_id ?? null,
    branchId: scope.branch_id ?? null,
    templateKey: recipient.template_key,
    templateRevision: recipient.template_revision,
    safeParameters: recipient.safe_parameters,
    deadline: recipient.send_deadline == null ? null : new Date(recipient.send_deadline),
  });
}
