import { notificationRedisOptions } from '@pospay/notifications';
import type {
  ClaimedEvent,
  DeliveryOutcome,
  TenantWrappers,
  Tx,
} from '@pospay/db';
import {
  createPhoneIdentity,
  createTemplateRegistry,
  FakeChannel,
  readNotificationConfiguration,
  WhatsAppChannel,
  type Channel,
  type NotificationConfiguration,
} from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';

import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import type { RatingTokenSender } from './ports/channel.port.ts';
import { resolveRatingPageOrigin } from './domain/rating-page-origin.ts';
import type { SendAdmission } from './ports/send-admission.port.ts';
import type { SuppressionGate } from './ports/suppression-gate.port.ts';
import { redisSendAdmission } from './persistence/redis-send-admission.ts';
import { createAttemptsRepository } from './persistence/drizzle-attempts.repository.ts';
import { createAuthorizationRepository } from './persistence/drizzle-authorization.repository.ts';
import { createInAppRepository } from './persistence/drizzle-in-app.repository.ts';
import { createPushAttemptsRepository } from './persistence/drizzle-push-attempts.repository.ts';
import { StoreInAppNotification } from './use-cases/store-in-app-notification/store-in-app-notification.ts';
import { StorePushAttempts } from './use-cases/store-push-attempts/store-push-attempts.ts';
import { createSuppressionGate } from './persistence/drizzle-suppression.gate.ts';
import { createChannelAdapter, type RatingLinkOptions } from './persistence/channel.adapter.ts';
import {
  NOTIFICATION_SOURCE_EVENTS,
  notificationRequestConsumer,
} from './events/handlers/on-notification-request.handler.ts';
import { AuthorizeNotification } from './use-cases/authorize-notification/authorize-notification.ts';
import { SendNotification } from './use-cases/send-notification/send-notification.ts';
import { ClearAbandonedDestination } from './use-cases/clear-abandoned-destination/clear-abandoned-destination.ts';
import {
  createNotificationTransport,
  NOTIFICATIONS_QUEUE,
} from './jobs/publish-authorized-notification.ts';
import { notificationProcessor } from './jobs/send-notification.processor.ts';
import { destinationCleanupProcessor } from './jobs/clear-abandoned-destination.processor.ts';
import { createEmailModule, type EmailModuleOptions } from './email.module.ts';
import { notificationQueue } from './jobs/notification-queue.ts';
import {
  productionClosedTeamAlertWhatsapp,
  type PhoneHashConfiguration,
} from './team-alert-whatsapp.ts';

export interface NotificationModuleOptions {
  readonly database: Pick<TenantWrappers, 'withTenant'>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly configuration: NotificationConfiguration;
  readonly production: boolean;
  readonly channel?: Channel;
  readonly registry?: ReturnType<typeof createTemplateRegistry>;
  readonly suppression?: (tx: Tx) => SuppressionGate;
  readonly admission?: SendAdmission;
  readonly emailConfiguration?: EmailModuleOptions['configuration'];
  readonly emailTesting?: EmailModuleOptions['testing'];
  readonly email?: ReturnType<typeof createEmailModule>;
  /** جاهزية الدفع في العامل: هي اللي بتفعّل كتابة محاولات الدفع (ADR-0052 قرار 2). */
  readonly push?: { readonly enabled: boolean };
  /** مشتق رابط التقييم في الذاكرة؛ null أو غيابه يقفل إرسال طلب التقييم بـ CONFIG_INVALID. */
  readonly ratingToken?: RatingTokenSender | null;
  /** أصل صفحة التقييم (RATING_PAGE_ORIGIN)؛ https صريح في الإنتاج أو الوضع الحي. */
  readonly ratingPageOrigin?: string | undefined;
}

export function createNotificationModule(options: NotificationModuleOptions) {
  const { configuration, clock, ids } = options;
  if ((options.production || configuration.mode === 'live') && options.admission === undefined)
    throw new Error('NOTIFICATIONS_LIVE_REQUIRES_PR6');
  if (options.production && configuration.mode !== 'live')
    throw new Error('NOTIFICATIONS_FAKE_IN_PRODUCTION');
  const identity = createPhoneIdentity(configuration.hashKey, configuration.hashKeyId);
  const registry = options.registry ?? createTemplateRegistry();
  const channel = options.channel ?? bindChannel(configuration, clock);
  const adapter = createChannelAdapter(channel, registry, ratingLinkOptions(options));
  const email =
    options.email ??
    createEmailModule({
      production: options.production || configuration.mode === 'live',
      clock,
      ids,
      ...(options.emailConfiguration === undefined
        ? {}
        : { configuration: options.emailConfiguration }),
      ...(options.emailTesting === undefined ? {} : { testing: options.emailTesting }),
    });
  const { routed, destinations } = routeChannels(adapter, identity, email);
  const attempts = createAttemptsRepository(options.database);
  const admission = options.admission ?? { reserve: async () => true };
  const send = new SendNotification(attempts, routed, admission, destinations, routed, clock, ids);
  const authorizeNotification = authorizerOf(options);
  const consumer = notificationRequestConsumer(
    authorizeNotification,
    identity,
    registry,
    (tx) => new StoreInAppNotification(createInAppRepository(tx), clock, ids),
    email.authorize,
    // جاهزية الدفع في العامل (إعداد VAPID) هي اللي بتفعّل الإرسال؛ من غيرها مفيش محاولات بتتكتب.
    {
      enabled: options.push?.enabled === true,
      store: (tx) => new StorePushAttempts(createPushAttemptsRepository(tx), clock, ids),
    },
    // واتساب تنبيهات الفريق بيفضل مقفول لحد قوالب Meta: محاولة FAILED / CONFIG_INVALID ظاهرة (ADR-0018 §11).
    { authorize: authorizeNotification, identity },
  );
  return {
    consumer,
    send,
    process: notificationProcessor(send),
    channel,
    emailCapability: email.capability,
    cleanup: destinationCleanupProcessor(new ClearAbandonedDestination(attempts, clock, ids)),
    eventTypes: [
      ...NOTIFICATION_SOURCE_EVENTS,
      'NotificationSendAuthorized',
      'NotificationDelivered',
      'NotificationFailed',
      // حدث إذن الدفع بيتكتب مع كل محاولة معلّقة، والـ worker بيوجّهه لطابور push-send لما الدفع يكون جاهز.
      'PushSendAuthorized',
    ],
  };
}

/** بوابة التفويض على معاملة المصدر: الإنتاج والوضع الحي بالبوابة الحقيقية، والاختبار ممكن يحقن بوابته. */
function authorizerOf(options: NotificationModuleOptions) {
  const live = options.production || options.configuration.mode === 'live';
  return (tx: Tx) =>
    new AuthorizeNotification(
      createAuthorizationRepository(tx),
      live ? createSuppressionGate(tx) : (options.suppression?.(tx) ?? createSuppressionGate(tx)),
      options.clock,
      options.ids,
    );
}

/** مدخلات رابط التقييم: المشتق في الذاكرة والأصل المتحقق منه؛ الأصل https صريح في الإنتاج أو الوضع الحي. */
function ratingLinkOptions(options: NotificationModuleOptions): RatingLinkOptions {
  return {
    token: options.ratingToken ?? null,
    origin: resolveRatingPageOrigin(
      options.ratingPageOrigin,
      options.production || options.configuration.mode === 'live',
    ),
  };
}

function routeChannels(
  adapter: ReturnType<typeof createChannelAdapter>,
  identity: ReturnType<typeof createPhoneIdentity>,
  email: ReturnType<typeof createEmailModule>,
) {
  return {
    routed: {
      send: (attempt: Parameters<typeof adapter.send>[0]) =>
        (attempt.channel === 'email' ? email.adapter : adapter).send(attempt),
      failure: (attempt: Parameters<typeof adapter.failure>[0]) =>
        (attempt.channel === 'email' ? email.adapter : adapter).failure(attempt),
    },
    destinations: {
      matches: (value: string, stored: Parameters<typeof identity.matches>[1]) =>
        (stored.last3 === '' ? email : identity).matches(value, stored),
    },
  };
}

function bindChannel(config: NotificationConfiguration, clock: Clock): Channel {
  if (config.mode === 'fake') return new FakeChannel(() => clock.now());
  if (config.accessToken === undefined || config.phoneNumberId === undefined)
    throw new Error('NOTIFICATION_PROVIDER_CONFIG_INVALID');
  return new WhatsAppChannel({
    accessToken: config.accessToken,
    phoneNumberId: config.phoneNumberId,
    now: () => clock.now(),
  });
}

export function startNotificationQueue(
  module: { readonly process: (job: Pick<Job, 'data'>) => Promise<void> },
  redisUrl: string,
  businessDeliver: (event: ClaimedEvent) => Promise<DeliveryOutcome>,
  logger: Logger,
) {
  const connection = notificationRedisOptions(redisUrl);
  const resource = notificationQueue(NOTIFICATIONS_QUEUE, connection, () =>
    logger.warn({}, 'notification queue error'),
  );
  const queue = resource.queue;
  const worker = new Worker(NOTIFICATIONS_QUEUE, module.process, { connection, concurrency: 4 });
  const logError = (error: unknown) => logger.warn({ err: error }, 'notification queue error');
  queue.on('error', logError);
  worker.on('error', logError);
  worker.on('failed', (job, error) =>
    logger.warn({ event: { id: job?.id }, err: error }, 'notification job failed'),
  );
  return {
    deliver: createNotificationTransport(queue, businessDeliver, logger),
    ready: async () => {
      await queue.waitUntilReady();
      await worker.waitUntilReady();
    },
    stop: () => worker.close(),
    close: async (force = false) => {
      await Promise.allSettled([worker.close(force), resource.close(force)]);
    },
  };
}

export { readNotificationConfiguration };

export { notificationRedisOptions };

export function createInAppNotificationModule(
  options: Pick<
    NotificationModuleOptions,
    'database' | 'ids' | 'clock' | 'emailConfiguration' | 'email' | 'push'
  > & { readonly phoneConfiguration?: PhoneHashConfiguration | null },
) {
  const email =
    options.email ??
    createEmailModule({
      production: true,
      ids: options.ids,
      clock: options.clock,
      ...(options.emailConfiguration === undefined
        ? {}
        : { configuration: options.emailConfiguration }),
    });
  const consumer = notificationRequestConsumer(
    () => {
      throw new Error('NOTIFICATIONS_LIVE_REQUIRES_PR6');
    },
    {
      identify: () => {
        throw new Error('NOTIFICATIONS_LIVE_REQUIRES_PR6');
      },
    },
    createTemplateRegistry(),
    (tx) => new StoreInAppNotification(createInAppRepository(tx), options.clock, options.ids),
    email.authorize,
    // جاهزية الدفع في العامل (إعداد VAPID) هي اللي بتفعّل الإرسال؛ من غيرها مفيش محاولات بتتكتب.
    {
      enabled: options.push?.enabled === true,
      store: (tx) =>
        new StorePushAttempts(createPushAttemptsRepository(tx), options.clock, options.ids),
    },
    productionClosedTeamAlertWhatsapp(options),
  );
  return {
    consumer,
    emailCapability: email.capability,
    eventTypes: [
      ...NOTIFICATION_SOURCE_EVENTS,
      'NotificationDelivered',
      'NotificationFailed',
      // حدث إذن الدفع بيتكتب مع كل محاولة معلّقة، والـ worker بيوجّهه لطابور push-send لما الدفع يكون جاهز.
      'PushSendAuthorized',
      // البريد المفعّل في الإنتاج بيفوّض من غير واتساب، فحدث الإذن لازم يكون معروف للـ dispatcher.
      ...(email.capability.enabled ? (['NotificationSendAuthorized'] as const) : []),
    ],
  };
}

/**
 * مسار إرسال البريد وحده: الإنتاج وواتساب مقفولة بالكامل، والبريد مفعّل.
 * القاعدة: الإذن بيتكتب في معاملة المصدر، والعامل بيبعت المحاولة المصرّح لها بس.
 */
export function createEmailSendModule(options: {
  readonly database: Pick<TenantWrappers, 'withTenant'>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly email: ReturnType<typeof createEmailModule>;
  readonly admission?: SendAdmission;
  readonly redis?: Redis;
}) {
  const attempts = createAttemptsRepository(options.database);
  const admission =
    options.admission ??
    (options.redis === undefined
      ? { reserve: async () => true }
      : redisSendAdmission(options.redis, 1000));
  // قراءة المحوّل وقت التنفيذ عشان غلق القدرة ينعكس فوراً على التصريف.
  const adapter = {
    send: (attempt: Parameters<typeof options.email.adapter.send>[0]) =>
      options.email.adapter.send(attempt),
    failure: (attempt: Parameters<typeof options.email.adapter.failure>[0]) =>
      options.email.adapter.failure(attempt),
  };
  const send = new SendNotification(
    attempts,
    adapter,
    admission,
    { matches: (value, stored) => options.email.matches(value, stored) },
    adapter,
    options.clock,
    options.ids,
  );
  return { process: notificationProcessor(send) };
}
