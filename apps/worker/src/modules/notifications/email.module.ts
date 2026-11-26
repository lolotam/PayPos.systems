import type { NotificationRecipient } from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';
import {
  createEmailIdentity,
  readEmailConfiguration,
  renderOperationalEmail,
  ResendChannel,
  type Channel,
  type EmailConfiguration,
  type EmailRequest,
} from '@pospay/notifications';
import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import type { SuppressionGate } from './ports/suppression-gate.port.ts';
import { createEmailChannelAdapter } from './persistence/email-channel.adapter.ts';
import { createAuthorizationRepository } from './persistence/drizzle-authorization.repository.ts';
import { createEmailSuppressionGate } from './persistence/drizzle-email-suppression.gate.ts';
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
  const adapter = createEmailChannelAdapter(
    options.testing?.channel ?? liveChannel(options, config),
    adminOrigin,
  );
  return {
    capability: { enabled: config.enabled, reason: config.reason } as const,
    adapter,
    matches: (
      destination: string,
      stored: Parameters<NonNullable<typeof identity>['matches']>[1],
    ) => identity?.matches(destination, stored) ?? false,
    authorize: emailAuthorizer(options, config, identity, adminOrigin),
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

function emailAuthorizer(
  options: EmailModuleOptions,
  config: EmailConfiguration,
  identity: ReturnType<typeof createEmailIdentity> | null,
  adminOrigin: string,
) {
  return async (tx: Tx, event: ClaimedEvent, recipient: EmailRecipient, scope: EmailScope) => {
    if (identity === null) throw new Error('EMAIL_DISABLED_HASH_UNAVAILABLE');
    const prepared = renderOperationalEmail(
      recipient.template_key,
      recipient.template_revision,
      recipient.locale ?? '',
      recipient.safe_parameters,
      adminOrigin,
    );
    const authorizer = new AuthorizeNotification(
      createAuthorizationRepository(tx),
      options.testing?.suppression?.(tx) ?? createEmailSuppressionGate(tx),
      options.clock,
      options.ids,
    );
    await authorizer.execute({
      companyId: event.companyId,
      sourceEventId: event.id,
      businessId: scope.business_id ?? null,
      branchId: scope.branch_id ?? null,
      channel: 'email',
      phone: '',
      email: recipient.email,
      identity: identity.identify(recipient.email),
      locale: recipient.locale ?? null,
      templateKey: recipient.template_key,
      templateRevision: recipient.template_revision,
      providerTemplateName: null,
      safeParameters: [],
      deadline: recipient.send_deadline == null ? null : new Date(recipient.send_deadline),
      configurationFailure:
        !config.enabled && options.testing === undefined
          ? 'CONFIG_INVALID'
          : prepared === null
            ? 'PARAMETERS_INVALID'
            : null,
    });
  };
}
