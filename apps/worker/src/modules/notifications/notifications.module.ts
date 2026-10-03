import {
  WHATSAPP_INBOUND_QUEUE,
  WHATSAPP_INBOX_ID,
  whatsappInboundJob,
} from '@pospay/notifications';
import { notificationRedisOptions } from '@pospay/notifications';
import type {
  ClaimedEvent,
  DeliveryOutcome,
  PlatformWhatsappDatabase,
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
import { Worker, type Queue } from 'bullmq';

import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import type { SendAdmission } from './ports/send-admission.port.ts';
import type { SuppressionGate } from './ports/suppression-gate.port.ts';
import { createAttemptsRepository } from './persistence/drizzle-attempts.repository.ts';
import { createAuthorizationRepository } from './persistence/drizzle-authorization.repository.ts';
import { createInAppRepository } from './persistence/drizzle-in-app.repository.ts';
import { StoreInAppNotification } from './use-cases/store-in-app-notification/store-in-app-notification.ts';
import { createSuppressionGate } from './persistence/drizzle-suppression.gate.ts';
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
import { createWhatsappInboxRepository } from './persistence/drizzle-whatsapp-inbox.repository.ts';
import { ProcessWhatsappInbox } from './use-cases/process-whatsapp-inbox/process-whatsapp-inbox.ts';
import { RecoverWhatsappInbox } from './use-cases/recover-whatsapp-inbox/recover-whatsapp-inbox.ts';
import { ClearWhatsappPayloads } from './use-cases/clear-whatsapp-payloads/clear-whatsapp-payloads.ts';
import { whatsappInboundProcessor } from './jobs/whatsapp-inbound.processor.ts';
import { whatsappMaintenanceProcessor } from './jobs/whatsapp-maintenance.processor.ts';
import { createEmailModule, type EmailModuleOptions } from './email.module.ts';
import { notificationQueue } from './jobs/notification-queue.ts';

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
  const adapter = createChannelAdapter(channel, registry);
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
  const consumer = notificationRequestConsumer(
    (tx) =>
      new AuthorizeNotification(
        createAuthorizationRepository(tx),
        options.production || configuration.mode === 'live'
          ? createSuppressionGate(tx)
          : (options.suppression?.(tx) ?? createSuppressionGate(tx)),
        clock,
        ids,
      ),
    identity,
    registry,
    (tx) => new StoreInAppNotification(createInAppRepository(tx), clock, ids),
    email.authorize,
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
    ],
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
  module: ReturnType<typeof createNotificationModule>,
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
    'database' | 'ids' | 'clock' | 'emailConfiguration' | 'email'
  >,
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
  );
  return {
    consumer,
    emailCapability: email.capability,
    eventTypes: [...NOTIFICATION_SOURCE_EVENTS, 'NotificationDelivered', 'NotificationFailed'],
  };
}

export function startWhatsappInbound(
  database: PlatformWhatsappDatabase,
  redisUrl: string,
  logger: Logger,
) {
  const connection = notificationRedisOptions(redisUrl);
  const error = () => logger.warn({}, 'whatsapp inbox queue error');
  const resource = notificationQueue(WHATSAPP_INBOUND_QUEUE, connection, error);
  const maintenanceResource = notificationQueue(
    'notifications-inbound-maintenance',
    connection,
    error,
  );
  const queue = resource.queue,
    maintenanceQueue = maintenanceResource.queue;
  const { worker, maintenanceWorker } = bindWhatsappProcessors(database, queue, connection);
  logWhatsappQueues([queue, maintenanceQueue], [worker, maintenanceWorker], logger);
  let scheduled = false;
  let closed = false;
  return {
    ready: async () => {
      if (closed) throw new Error('WHATSAPP_CAPABILITY_UNAVAILABLE');
      await database.ping();
      await Promise.all([
        queue.waitUntilReady(),
        maintenanceQueue.waitUntilReady(),
        worker.waitUntilReady(),
        maintenanceWorker.waitUntilReady(),
      ]);
      if (closed) throw new Error('WHATSAPP_CAPABILITY_UNAVAILABLE');
      if (!scheduled) {
        await scheduleWhatsappMaintenance(maintenanceQueue, () => closed);
        scheduled = true;
      }
    },
    stop: async () => {
      await Promise.all([worker.close(), maintenanceWorker.close()]);
    },
    close: async (force = false) => {
      closed = true;
      await Promise.allSettled([
        worker.close(force),
        maintenanceWorker.close(force),
        resource.close(force),
        maintenanceResource.close(force),
      ]);
    },
  };
}

async function scheduleWhatsappMaintenance(queue: Queue, closed: () => boolean) {
  await queue.upsertJobScheduler(
    'recover-inbox',
    { every: 30_000 },
    {
      name: 'recover-inbox',
      data: {},
      opts: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    },
  );
  if (closed()) throw new Error('WHATSAPP_CAPABILITY_UNAVAILABLE');
  await queue.upsertJobScheduler(
    'clear-payloads',
    { every: 60 * 60 * 1000 },
    {
      name: 'clear-payloads',
      data: {},
      opts: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    },
  );
}

function bindWhatsappProcessors(
  database: PlatformWhatsappDatabase,
  queue: Queue,
  connection: ReturnType<typeof notificationRedisOptions>,
) {
  const inbox = createWhatsappInboxRepository(database);
  const clock = { now: () => new Date() };
  const recover = new RecoverWhatsappInbox(
    inbox,
    {
      enqueue: async (id) => {
        const job = whatsappInboundJob(id);
        await queue.add(job.name, job.data, job.options);
      },
    },
    clock,
  );
  const worker = new Worker(
    WHATSAPP_INBOUND_QUEUE,
    whatsappInboundProcessor(new ProcessWhatsappInbox(inbox, clock)),
    { connection, concurrency: 4 },
  );
  const maintenanceWorker = new Worker(
    'notifications-inbound-maintenance',
    whatsappMaintenanceProcessor(recover, new ClearWhatsappPayloads(inbox, clock)),
    { connection, concurrency: 1 },
  );
  return { worker, maintenanceWorker };
}

function logWhatsappQueues(queues: Queue[], workers: Worker[], logger: Logger): void {
  const error = () => logger.warn({}, 'whatsapp inbox queue error');
  for (const source of queues) source.on('error', error);
  for (const source of workers) source.on('error', error);
  for (const source of workers)
    source.on('failed', (job, error) =>
      logger.warn(
        {
          event: {
            id: job?.id !== undefined && WHATSAPP_INBOX_ID.test(job.id) ? job.id : undefined,
          },
          err: error,
        },
        'whatsapp inbox job failed',
      ),
    );
}
