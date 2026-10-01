import { createDatabase, createOutboxDispatcherDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';

import { createDeliverer } from './outbox/deliver.ts';
import {
  createNotificationModule,
  readNotificationConfiguration,
  startNotificationQueue,
} from './modules/notifications/index.ts';
import { createDispatchLoop } from './outbox/dispatch-loop.ts';
import { readConfig } from './shared/config.ts';
import { WORKER_LOG_EVENTS } from './shared/log-events.ts';
import { createWorker } from './worker.ts';

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: WORKER_LOG_EVENTS });

const app = createDatabase({ url: config.DATABASE_URL, ids: systemUuidV7() });
const dispatcher = createOutboxDispatcherDatabase({ url: config.DISPATCHER_DATABASE_URL });
const redis = new Redis(config.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
// Attached before any connection event, so ioredis never prints raw errors outside the logger.
redis.on('error', (error: unknown) => {
  logger.warn({ err: error }, 'redis connection error');
});

// ADR-0018 §2: الإشعارات ما بتشتغلش في production (و staging كمان) لحد ما PR 5 يربط الـ suppression الحقيقي.
// الـ worker بيكمّل يوزّع باقي الأحداث؛ وأنواع أحداث الإشعارات مش «معروفة» هنا، فأي طلب بيستنى ويتركن بدل ما يضيع.
const production = process.env['NODE_ENV'] === 'production';
const notifications = production
  ? null
  : createNotificationModule({
      database: app,
      ids: systemUuidV7(),
      clock: { now: () => new Date() },
      configuration: readNotificationConfiguration(process.env),
      production,
    });
const KNOWN_EVENT_TYPES = [
  ...(notifications?.eventTypes ?? []),
  'CompanyCreated',
  'BusinessCreated',
  'BranchCreated',
  'BusinessSettingsUpdated',
];
const businessDeliver = createDeliverer(
  app,
  notifications === null ? [] : [notifications.consumer],
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
  await Promise.allSettled([queue?.close(), dispatcher.close(), app.close(), redis.quit()]);
  redis.disconnect();
};

try {
  const worker = await createWorker(
    {
      readiness: [
        ...(queue === null ? [] : [{ name: 'notifications', check: () => queue.ready() }]),
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
  await release();
  process.exit(1);
}
