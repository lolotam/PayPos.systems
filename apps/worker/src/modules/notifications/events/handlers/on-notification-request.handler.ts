import {
  notificationRequest,
  RATING_REQUEST_TEMPLATE_KEY,
  RATING_TOKEN_KEY_VERSION_MAX,
  RATING_TOKEN_KEY_VERSION_PARAMETER,
  type InAppRecipient,
  type NotificationRecipient,
  type PushRecipient,
} from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';
import type {
  createPhoneIdentity,
  createTemplateRegistry,
  SafeParameter,
} from '@pospay/notifications';

import type { OutboxConsumer } from '../../../../outbox/consumer.ts';
import type { AuthorizeNotification } from '../../use-cases/authorize-notification/authorize-notification.ts';
import type { StoreInAppNotification } from '../../use-cases/store-in-app-notification/store-in-app-notification.ts';
import type { StorePushAttempts } from '../../use-cases/store-push-attempts/store-push-attempts.ts';
import {
  validInAppTemplate,
  validLowRatingTemplate,
  sanitizePushParameters,
} from '@pospay/notifications';
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
  'PackageRefundNoticeRequested',
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
  'ShiftEndsSoon',
  'DocumentExpiring',
  'StatementAwaitingReview',
  'StatementAwaitingApproval',
  'CommissionCorrectionBlockedNoticeRequested',
  'CommissionEventParkedNoticeRequested',
  'StaffAccessGrantedNoticeRequested',
  'StaffPinSetByOtherNoticeRequested',
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
  const stored = storedParameters(event, recipient, prepared);
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
    providerTemplateName: stored.providerTemplateName,
    safeParameters: stored.safeParameters,
    deadline: recipient.send_deadline == null ? null : new Date(recipient.send_deadline),
    configurationFailure: stored.configurationFailure,
  });
}

/**
 * يحدد ما يُخزَّن في محاولة الإذن: معاملات القالب المعتمدة، ولطلب التقييم يضاف إليها إصدار مفتاح الرابط من حدث الجاهزية.
 * إصدار المفتاح رقم فقط (لا رابط ولا توكن)، والرابط نفسه يُشتق في الذاكرة وقت الإرسال ولا يُخزَّن أبداً.
 *
 * @param event حدث الجاهزية المستلَم
 * @param recipient المستلم الجاهز للتفويض
 * @param prepared نتيجة تحضير القالب أو null لما اللغة غير مدعومة
 * @returns اسم قالب المزود والمعاملات المخزنة وسبب الرفض إن وُجد
 */
function storedParameters(
  event: ClaimedEvent,
  recipient: ScheduledRecipient,
  prepared: ReturnType<AuthorizeDependencies['registry']['prepare']> | null,
): {
  readonly providerTemplateName: string | null;
  readonly safeParameters: ScheduledRecipient['safe_parameters'] | readonly SafeParameter[];
  readonly configurationFailure: 'CONFIG_INVALID' | 'PARAMETERS_INVALID' | null;
} {
  if (prepared?.valid !== true)
    return {
      providerTemplateName: null,
      safeParameters: [],
      configurationFailure: prepared?.valid === false ? prepared.code : null,
    };
  if (recipient.template_key !== RATING_REQUEST_TEMPLATE_KEY)
    return {
      providerTemplateName: prepared.name,
      safeParameters: recipient.safe_parameters,
      configurationFailure: null,
    };
  const version = isRecord(event.payload)
    ? event.payload[RATING_TOKEN_KEY_VERSION_PARAMETER]
    : undefined;
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1 ||
    version > RATING_TOKEN_KEY_VERSION_MAX
  )
    return {
      providerTemplateName: null,
      safeParameters: [],
      configurationFailure: 'PARAMETERS_INVALID',
    };
  return {
    providerTemplateName: prepared.name,
    safeParameters: [
      ...recipient.safe_parameters,
      { name: RATING_TOKEN_KEY_VERSION_PARAMETER, type: 'number', value: version },
    ],
    configurationFailure: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (!validTemplate(recipient)) throw new Error('NOTIFICATION_REQUEST_INVALID');
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

// جرس التقييم المنخفض معامله كائن تفاصيل، فله مدقق خاص؛ باقي القوالب معاملاتها نصية ومدققها العام ما اتغيرش.
function validTemplate(recipient: InAppRecipient): boolean {
  const { template_key: key, template_revision: revision, locale } = recipient;
  if (key === 'low_rating' || key === 'low_rating_with_comment')
    return validLowRatingTemplate(key, revision, locale, recipient.safe_parameters);
  return validInAppTemplate(key, revision, locale, recipient.safe_parameters);
}

// مسار الدفع: القالب بيتأكد قبل أي كتابة، والمرسل غير المهيّأ بيسيب الطلب عادي من غير خطأ.
async function storePushRecipient(
  push: PushStore | undefined,
  tx: Tx,
  event: ClaimedEvent,
  recipient: PushRecipient,
  scope: EmailScope,
): Promise<void> {
  const safeParameters = sanitizePushParameters(
    recipient.template_key,
    recipient.template_revision,
    recipient.safe_parameters,
  );
  if (safeParameters === null) throw new Error('NOTIFICATION_REQUEST_INVALID');
  if (push === undefined || !push.enabled) return;
  await push.store(tx).execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    userId: recipient.user_id,
    businessId: scope.business_id ?? null,
    branchId: scope.branch_id ?? null,
    templateKey: recipient.template_key,
    templateRevision: recipient.template_revision,
    safeParameters,
    deadline: recipient.send_deadline == null ? null : new Date(recipient.send_deadline),
  });
}
