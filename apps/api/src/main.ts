import { createAuth } from '@pospay/auth';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';

import { createApp } from './app.ts';
import { API_LOG_EVENTS } from './shared/log-events.ts';
import { readConfig } from './shared/config.ts';

const config = readConfig(process.env);
const logger = createLogger(config.LOG_LEVEL, { events: API_LOG_EVENTS });

// UUID v7 on the system clock and Web Crypto — bound to @pospay/db's IdGenerator here, at the composition root.
const database = createDatabase({ url: config.DATABASE_URL, ids: systemUuidV7() });
const auth = createAuth({
  databaseUrl: config.AUTH_DATABASE_URL,
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.BETTER_AUTH_URL,
  trustedOrigins: config.AUTH_TRUSTED_ORIGINS,
  ids: systemUuidV7(),
  secureCookies: config.BETTER_AUTH_URL.startsWith('https:'),
});

// No offline queue: while Redis is down a command fails at once, so /ready reports it instead of hanging.
const redis = new Redis(config.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
// Attached before any connection event: without a listener ioredis prints raw errors to stderr,
// outside the sanitising logger.
redis.on('error', (error: unknown) => {
  logger.warn({ err: error }, 'redis connection error');
});

const RELEASE_DEADLINE_MS = 5_000;

// One bounded cleanup for both startup failure and shutdown: close gracefully, then force the Redis
// socket shut if the deadline passes (the database close has its own 5 s forced end).
const release = async (): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, RELEASE_DEADLINE_MS);
  });
  await Promise.race([
    Promise.allSettled([database.close(), auth.close(), redis.quit()]),
    deadline,
  ]);
  clearTimeout(timer);
  redis.disconnect();
};

try {
  const app = await createApp(
    {
      readiness: [
        { name: 'database', check: () => database.ping() },
        { name: 'auth', check: () => auth.ping() },
        {
          name: 'redis',
          check: async () => {
            await redis.ping();
          },
        },
      ],
      onShutdown: release,
      auth: { service: auth, baseURL: config.BETTER_AUTH_URL },
    },
    { logger },
  );
  app.enableShutdownHooks();
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  // Only the sanitised diagnostic is logged — the error's message can carry a connection string.
  logger.fatal({ err: error }, 'api failed to start');
  await release();
  process.exit(1);
}
