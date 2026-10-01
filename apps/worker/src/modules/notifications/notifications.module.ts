import type { ClaimedEvent, DeliveryOutcome, TenantWrappers, Tx } from '@pospay/db';
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
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import type { SendAdmission } from './ports/send-admission.port.ts';
import type { SuppressionGate } from './ports/suppression-gate.port.ts';
import { createAttemptsRepository } from './persistence/drizzle-attempts.repository.ts';
import { createAuthorizationRepository } from './persistence/drizzle-authorization.repository.ts';
import { createInAppRepository } from './persistence/drizzle-in-app.repository.ts';
import { StoreInAppNotification } from './use-cases/store-in-app-notification/store-in-app-notification.ts';
import { noSuppressionGate } from './persistence/no-suppression.gate.ts';
import { createChannelAdapter } from './persistence/channel.adapter.ts';
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
}

export function createNotificationModule(options: NotificationModuleOptions) {
  const { configuration, clock, ids } = options;
  if (options.production || configuration.mode !== 'fake')
    throw new Error('NOTIFICATIONS_LIVE_REQUIRES_PR5');
  const identity = createPhoneIdentity(configuration.hashKey, configuration.hashKeyId);
  const registry = options.registry ?? createTemplateRegistry();
  const channel = options.channel ?? bindChannel(configuration, clock);
  const adapter = createChannelAdapter(channel, registry);
  const attempts = createAttemptsRepository(options.database);
  const admission = options.admission ?? { reserve: async () => true };
  const send = new SendNotification(attempts, adapter, admission, identity, adapter, clock, ids);
  const consumer = notificationRequestConsumer(
    (tx) =>
      new AuthorizeNotification(
        createAuthorizationRepository(tx),
        options.suppression?.(tx) ?? noSuppressionGate(configuration.mode, options.production),
        clock,
        ids,
      ),
    identity,
    registry,
    (tx) => new StoreInAppNotification(createInAppRepository(tx), clock, ids),
  );
  return {
    consumer,
    send,
    process: notificationProcessor(send),
    channel,
    cleanup: destinationCleanupProcessor(new ClearAbandonedDestination(attempts, clock, ids)),
    eventTypes: [
      ...NOTIFICATION_SOURCE_EVENTS,
      'NotificationSendAuthorized',
      'NotificationDelivered',
      'NotificationFailed',
    ],
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

export function notificationRedisOptions(url: string): ConnectionOptions {
  const parsed = new URL(url);
  if (!['redis:', 'rediss:'].includes(parsed.protocol))
    throw new Error('NOTIFICATION_REDIS_CONFIG_INVALID');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || '6379'),
    ...(parsed.username === '' ? {} : { username: decodeURIComponent(parsed.username) }),
    ...(parsed.password === '' ? {} : { password: decodeURIComponent(parsed.password) }),
    db: parsed.pathname === '/' || parsed.pathname === '' ? 0 : Number(parsed.pathname.slice(1)),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

export function startNotificationQueue(
  module: ReturnType<typeof createNotificationModule>,
  redisUrl: string,
  businessDeliver: (event: ClaimedEvent) => Promise<DeliveryOutcome>,
  logger: Logger,
) {
  const connection = notificationRedisOptions(redisUrl);
  const queue = new Queue(NOTIFICATIONS_QUEUE, {
    connection: { ...connection, enableOfflineQueue: false, maxRetriesPerRequest: 1 },
  });
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
    close: () => queue.close(),
  };
}

export { readNotificationConfiguration };
