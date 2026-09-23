import { createDatabase } from '@pospay/db';
import { Redis } from 'ioredis';

import { createApp } from './app.ts';
import { readConfig } from './shared/config.ts';

const config = readConfig(process.env);

// The UUID v7 generator arrives with packages/ids in T7; nothing calls withNewTenant before then.
const database = createDatabase({
  url: config.DATABASE_URL,
  ids: {
    newId: () => {
      throw new Error('IdGenerator is not wired yet (plan v4 T7)');
    },
  },
});

// No offline queue: while Redis is down a command fails at once, so /ready reports it instead of hanging.
const redis = new Redis(config.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });

const release = async (): Promise<void> => {
  await Promise.allSettled([database.close(), redis.quit()]);
};

try {
  const app = await createApp(
    {
      readiness: [
        { name: 'database', check: () => database.ping() },
        {
          name: 'redis',
          check: async () => {
            await redis.ping();
          },
        },
      ],
      onShutdown: release,
    },
    { logLevel: config.LOG_LEVEL },
  );
  app.enableShutdownHooks();
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  // Startup failed after resources were opened: release them, and report only the error's type — its
  // message can carry a connection string.
  await release();
  console.error(`API failed to start: ${error instanceof Error ? error.name : typeof error}`);
  process.exit(1);
}
