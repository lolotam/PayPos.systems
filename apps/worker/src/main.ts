import { createDatabase, createOutboxDispatcherDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';

import { createDeliverer } from './outbox/deliver.ts';
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

// No consumer exists yet in Phase 0; each module registers its handlers here as it gains them.
const loop = createDispatchLoop({ dispatcher, deliver: createDeliverer(app, [], logger), logger });

const release = async (): Promise<void> => {
  await Promise.allSettled([dispatcher.close(), app.close(), redis.quit()]);
  redis.disconnect();
};

try {
  const worker = await createWorker(
    {
      readiness: [
        { name: 'database', check: () => app.ping() },
        {
          name: 'redis',
          check: async () => {
            await redis.ping();
          },
        },
      ],
      stopPolling: () => loop.stop(),
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
  await release();
  process.exit(1);
}
