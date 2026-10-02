import {
  createDatabase,
  createOutboxDispatcherDatabase,
  createPlatformWhatsappDatabase,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';
import { readEmailConfiguration } from '@pospay/notifications';

import { createDeliverer } from './outbox/deliver.ts';
import {
  createNotificationModule,
  createInAppNotificationModule,
  startWhatsappInbound,
  readNotificationConfiguration,
  startNotificationQueue,
} from './modules/notifications/index.ts';
import { createDispatchLoop } from './outbox/dispatch-loop.ts';
import { readConfig } from './shared/config.ts';
import { WORKER_LOG_EVENTS } from './shared/log-events.ts';
import { createWorker } from './worker.ts';

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: WORKER_LOG_EVENTS });
const emailConfiguration = readEmailConfiguration(process.env);
logger.info(
  { capability: { channel: 'email', enabled: false, reason: emailConfiguration.reason } },
  'email disabled',
);

const app = createDatabase({ url: config.DATABASE_URL, ids: systemUuidV7() });
const dispatcher = createOutboxDispatcherDatabase({ url: config.DISPATCHER_DATABASE_URL });
const redis = new Redis(config.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
// Attached before any connection event, so ioredis never prints raw errors outside the logger.
redis.on('error', (error: unknown) => {
  logger.warn({ err: error }, 'redis connection error');
});

// ADR-0013 §5: معالجة in-app والاستقبال مستقلة؛ الإرسال وOTP يظلان مقفولين حتى admission المعتمد في PR 6.
const production = process.env['NODE_ENV'] === 'production';
const notifications = production
  ? null
  : createNotificationModule({
      database: app,
      ids: systemUuidV7(),
      clock: { now: () => new Date() },
      configuration: readNotificationConfiguration(process.env),
      production,
      emailConfiguration,
    });
const inApp = production
  ? createInAppNotificationModule({
      database: app,
      ids: systemUuidV7(),
      clock: { now: () => new Date() },
      emailConfiguration,
    })
  : null;
const intakeUrl = process.env['PLATFORM_NOTIFICATIONS_DATABASE_URL'];
const globalDatabase = intakeUrl ? createPlatformWhatsappDatabase({ url: intakeUrl }) : undefined;
let inbound: ReturnType<typeof startWhatsappInbound> | undefined;
const KNOWN_EVENT_TYPES = [
  ...(notifications?.eventTypes ?? []),
  ...(inApp?.eventTypes ?? []),
  'CompanyCreated',
  'BusinessCreated',
  'BranchCreated',
  'BusinessSettingsUpdated',
];
const businessDeliver = createDeliverer(
  app,
  notifications === null ? (inApp === null ? [] : [inApp.consumer]) : [notifications.consumer],
  logger,
  { knownEventTypes: KNOWN_EVENT_TYPES },
);
const queue =
  notifications === null
    ? null
    : startNotificationQueue(notifications, config.REDIS_URL, businessDeliver, logger);
const deliver = queue?.deliver ?? businessDeliver;
const loop = createDispatchLoop({ dispatcher, deliver, logger });

const release = async (): Promise<void> => {
  await Promise.allSettled([
    inbound?.close(),
    globalDatabase?.close(),
    queue?.close(),
    dispatcher.close(),
    app.close(),
    redis.quit(),
  ]);
  redis.disconnect();
};

try {
  if (globalDatabase !== undefined) {
    await globalDatabase.ping();
    inbound = startWhatsappInbound(globalDatabase, config.REDIS_URL, logger);
    await inbound.ready();
  }
  const worker = await createWorker(
    {
      readiness: [
        ...(queue === null ? [] : [{ name: 'notifications', check: () => queue.ready() }]),
        ...(inbound === undefined ? [] : [{ name: 'whatsapp-inbound', check: inbound.ready }]),
        { name: 'database', check: () => app.ping() },
        // A wrong dispatcher URL or password leaves the worker with nothing to do — it is not ready.
        { name: 'dispatcher', check: () => dispatcher.ping() },
        {
          name: 'redis',
          check: async () => {
            await redis.ping();
          },
        },
      ],
      stopPolling: async () => {
        await loop.stop();
        await queue?.stop();
        await inbound?.stop();
      },
      release,
    },
    logger,
  );
  worker.enableShutdownHooks();
  await worker.listen({ host: config.WORKER_HOST, port: config.WORKER_PORT });
  loop.start();
} catch (error) {
  // Only the sanitised diagnostic is logged — the error's message can carry a connection string.
  logger.fatal({ err: error }, 'worker failed to start');
  await loop.stop();
  await queue?.stop();
  await inbound?.stop();
  await release();
  process.exit(1);
}
