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

const app = await createApp({
  readiness: [
    { name: 'database', check: () => database.ping() },
    {
      name: 'redis',
      check: async () => {
        await redis.ping();
      },
    },
  ],
});

app.enableShutdownHooks();
const close = app.close.bind(app);
app.close = async () => {
  await close();
  await Promise.allSettled([database.close(), redis.quit()]);
};

await app.listen({ host: config.API_HOST, port: config.API_PORT });
