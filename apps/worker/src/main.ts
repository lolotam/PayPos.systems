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

// Every event type this version publishes, consumed or not, and the consumers; each module adds its own as
// it gains them. Phase 0 has neither yet, so every event would wait (and park) — none is published before T8.
const KNOWN_EVENT_TYPES: readonly string[] = [];
const deliver = createDeliverer(app, [], logger, { knownEventTypes: KNOWN_EVENT_TYPES });
const loop = createDispatchLoop({ dispatcher, deliver, logger });

const release = async (): Promise<void> => {
  await Promise.allSettled([dispatcher.close(), app.close(), redis.quit()]);
  redis.disconnect();
};

try {
  const worker = await createWorker(
    {
      readiness: [
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
