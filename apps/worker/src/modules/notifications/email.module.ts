import { randomBytes } from 'node:crypto';
import { TEAM_ALERT_TEMPLATE_KEYS, type NotificationRecipient } from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';
import {
  createEmailIdentity,
  deriveOnboardingEnvelopeKey,
  readEmailConfiguration,
  renderOperationalEmail,
  ResendChannel,
  type Channel,
  type EmailConfiguration,
  type EmailRequest,
} from '@pospay/notifications';
import type { Attempt, NotificationInput } from './domain/attempt-status.ts';
import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import type { SuppressionGate } from './ports/suppression-gate.port.ts';
import { createEmailChannelAdapter } from './persistence/email-channel.adapter.ts';
import { createAuthorizationRepository } from './persistence/drizzle-authorization.repository.ts';
import { createEmailSuppressionGate } from './persistence/drizzle-email-suppression.gate.ts';
import {
  isOnboardingTemplate,
  onboardingDestinationMatches,
  unsealAttempt,
} from './persistence/onboarding-envelope.ts';
import { AuthorizeNotification } from './use-cases/authorize-notification/authorize-notification.ts';

export interface EmailModuleOptions {
  readonly production: boolean;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly configuration?: EmailConfiguration;
  /** جاهزية استقبال ردّ المزود: false يقفل القناة حتى لو باقي الإعدادات صح. */
  readonly feedbackReady?: boolean;
  /** بيئة العملية؛ بتقرأ منها الإعداد لما مفيش configuration جوّالة. */
  readonly env?: NodeJS.ProcessEnv;
  readonly testing?: {
    readonly channel: Channel<EmailRequest>;
    readonly suppression?: (tx: Tx) => SuppressionGate;
  };
}
export type EmailRecipient = Extract<NotificationRecipient, { channel: 'email' }>;
export type EmailScope = {
  business_id?: string | null | undefined;
  branch_id?: string | null | undefined;
};

export function createEmailModule(options: EmailModuleOptions) {
  if (
    (options.production || process.env['NODE_ENV'] === 'production') &&
    options.testing !== undefined
  )
    throw new Error('EMAIL_TEST_CHANNEL_IN_PRODUCTION');
  const config =
    options.configuration ??
    readEmailConfiguration(
      options.env ?? {},
      options.feedbackReady === undefined ? {} : { feedbackReady: options.feedbackReady },
    );
  const identity =
    config.hashKey && config.hashKeyId
      ? createEmailIdentity(config.hashKey, config.hashKeyId)
      : null;
  const adminOrigin = config.adminOrigin ?? 'https://app.pospay.systems';
  // إيميلات الترحيب بتتختم بمفتاح البصمة نفسه؛ من غيره ما فيش مظروف ينفك.
  const envelopeKey = config.hashKey ? deriveOnboardingEnvelopeKey(config.hashKey) : null;
  const adapter = createEmailChannelAdapter(
    options.testing?.channel ?? liveChannel(options, config),
    adminOrigin,
    envelopeKey === null
      ? undefined
      : (attempt) => {
          const payload = unsealAttempt(attempt, envelopeKey, options.clock.now());
          return payload === null ? null : { email: payload.email, payload };
        },
  );
  return {
    capability: { enabled: config.enabled, reason: config.reason } as const,
    adapter,
    matches: (
      destination: string,
      stored: Parameters<NonNullable<typeof identity>['matches']>[1],
      attempt?: Attempt,
    ) => {
      if (attempt !== undefined && isOnboardingTemplate(attempt.templateKey)) {
        if (envelopeKey === null) return false;
        const payload = unsealAttempt(attempt, envelopeKey, options.clock.now());
        if (payload === null) return false;
        if (!onboardingDestinationMatches(payload, destination, envelopeKey)) return false;
        return identity?.matches(payload.email, stored) ?? false;
      }
      return identity?.matches(destination, stored) ?? false;
    },
    authorize: emailAuthorizer(options, config, identity, adminOrigin, envelopeKey),
  };
}

/** القناة الحقيقية بتتبني بس لما كل الإعدادات صح؛ غير كده مفيش قناة ومفيش إرسال. */
function liveChannel(
  options: EmailModuleOptions,
  config: EmailConfiguration,
): Channel<EmailRequest> | undefined {
  if (!config.enabled || options.testing !== undefined) return undefined;
  return new ResendChannel({
    now: () => options.clock.now(),
    env: {
      RESEND_API_KEY: config.apiKey ?? '',
      EMAIL_FROM_ADDRESS: config.fromAddress ?? '',
      EMAIL_FROM_NAME: config.fromName ?? '',
      EMAIL_REPLY_TO: config.replyTo ?? '',
      EMAIL_ADMIN_ORIGIN: config.adminOrigin ?? '',
    },
  });
}

const TEAM_ALERT_KEYS: ReadonlySet<string> = new Set(TEAM_ALERT_TEMPLATE_KEYS);

function emailAuthorizer(
  options: EmailModuleOptions,
  config: EmailConfiguration,
  identity: ReturnType<typeof createEmailIdentity> | null,
  adminOrigin: string,
  envelopeKey: Buffer | null,
) {
  // لو مفتاح بصمة البريد ناقص، بنستعمل مفتاح عشوائي مؤقت في الذاكرة لتنبيهات الفريق عشان نسجّل FAILED / CONFIG_INVALID
  // بدل ما يسقط التنبيه في صمت (AL-Q6، ADR-0018 §11)؛ غير تنبيهات الفريق بيفضل يرمي EMAIL_DISABLED_HASH_UNAVAILABLE.
  const unconfiguredIdentity = createEmailIdentity(randomBytes(32).toString('hex'), 'unconfigured');
  return async (tx: Tx, event: ClaimedEvent, recipient: EmailRecipient, scope: EmailScope) => {
    if (identity === null && !TEAM_ALERT_KEYS.has(recipient.template_key))
      throw new Error('EMAIL_DISABLED_HASH_UNAVAILABLE');
    const activeIdentity = identity ?? unconfiguredIdentity;
    const authorizer = new AuthorizeNotification(
      createAuthorizationRepository(tx),
      identity === null
        ? { isSuppressed: async () => false }
        : (options.testing?.suppression?.(tx) ?? createEmailSuppressionGate(tx)),
      options.clock,
      options.ids,
    );
    const input = {
      options,
      config,
      identity,
      activeIdentity,
      adminOrigin,
      envelopeKey,
      event,
      recipient,
      scope,
    };
    await authorizer.execute(
      isOnboardingTemplate(recipient.template_key)
        ? onboardingNotificationInput(input)
        : teamNotificationInput(input),
    );
  };
}

/** محاولة تنبيه الفريق: العنصر الصريح مفيش، والقالب جاهز من غير معاملات. */
function teamNotificationInput(input: {
  readonly options: EmailModuleOptions;
  readonly config: EmailConfiguration;
  readonly identity: ReturnType<typeof createEmailIdentity> | null;
  readonly activeIdentity: ReturnType<typeof createEmailIdentity>;
  readonly adminOrigin: string;
  readonly event: ClaimedEvent;
  readonly recipient: EmailRecipient;
  readonly scope: EmailScope;
}): NotificationInput {
  const { options, config, identity, activeIdentity, adminOrigin, event, recipient, scope } = input;
  const prepared = renderOperationalEmail(
    recipient.template_key,
    recipient.template_revision,
    recipient.locale ?? '',
    recipient.safe_parameters,
    adminOrigin,
  );
  return {
    companyId: event.companyId,
    sourceEventId: event.id,
    businessId: scope.business_id ?? null,
    branchId: scope.branch_id ?? null,
    channel: 'email',
    phone: '',
    email: recipient.email,
    identity: activeIdentity.identify(recipient.email),
    locale: recipient.locale ?? null,
    templateKey: recipient.template_key,
    templateRevision: recipient.template_revision,
    providerTemplateName: null,
    safeParameters: [],
    deadline: recipient.send_deadline == null ? null : new Date(recipient.send_deadline),
    configurationFailure:
      identity === null || (!config.enabled && options.testing === undefined)
        ? 'CONFIG_INVALID'
        : prepared === null
          ? 'PARAMETERS_INVALID'
          : null,
  };
}

/** إيميلات الترحيب: بتتفك من المظروف المشفّر، والمحوّلة ما بتتسجّلش أبداً. */
function onboardingNotificationInput(input: {
  readonly options: EmailModuleOptions;
  readonly config: EmailConfiguration;
  readonly activeIdentity: ReturnType<typeof createEmailIdentity>;
  readonly adminOrigin: string;
  readonly envelopeKey: Buffer | null;
  readonly event: ClaimedEvent;
  readonly recipient: EmailRecipient;
  readonly scope: EmailScope;
}): NotificationInput {
  const { options, config, activeIdentity, adminOrigin, envelopeKey, event, recipient, scope } =
    input;
  const disabled = !config.enabled && options.testing === undefined;
  const unsealed =
    disabled || envelopeKey === null
      ? null
      : unsealAttempt(
          {
            companyId: event.companyId,
            templateKey: recipient.template_key,
            templateRevision: recipient.template_revision,
            email: recipient.email,
            safeParameters: recipient.safe_parameters,
          },
          envelopeKey,
          options.clock.now(),
        );
  const prepared =
    unsealed === null
      ? null
      : renderOperationalEmail(
          recipient.template_key,
          recipient.template_revision,
          recipient.locale ?? '',
          [unsealed],
          adminOrigin,
        );
  const failure = disabled ? 'CONFIG_INVALID' : prepared === null ? 'PARAMETERS_INVALID' : null;
  return {
    companyId: event.companyId,
    sourceEventId: event.id,
    businessId: scope.business_id ?? null,
    branchId: scope.branch_id ?? null,
    channel: 'email',
    phone: '',
    email: recipient.email,
    identity: activeIdentity.identify(unsealed?.email ?? recipient.email),
    locale: recipient.locale ?? null,
    templateKey: recipient.template_key,
    templateRevision: recipient.template_revision,
    providerTemplateName: null,
    safeParameters: failure === null ? recipient.safe_parameters : [],
    deadline: recipient.send_deadline == null ? null : new Date(recipient.send_deadline),
    configurationFailure: failure,
  };
}
