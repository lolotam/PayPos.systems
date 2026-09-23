import { createAuth } from '@pospay/auth';
import { PROVISIONAL_PLAN_ID, createDatabase, grantPlatformPermission } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { readConfig } from '../src/shared/config.ts';
import { createDemoData } from './demo-data.ts';
import { assertDevelopmentTarget } from './demo-guard.ts';
import { demoReads } from './demo-reads.ts';

// pnpm --filter @pospay/api demo:seed — the demo companies of plan v4 T8 on a developer's own database. Compiled with
// tsconfig.scripts.json first (Nest's decorators need tsc). Safe to re-run: it completes whatever is missing.
assertDevelopmentTarget(process.env);
const config = readConfig(process.env);
const ownerUrl = process.env['MIGRATION_DATABASE_URL'] ?? '';
const origin = config.AUTH_TRUSTED_ORIGINS[0];
if (origin === undefined) throw new Error('AUTH_TRUSTED_ORIGINS needs at least one origin');

const ids = systemUuidV7();
const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
const auth = await createAuth({
  databaseUrl: config.AUTH_DATABASE_URL,
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.BETTER_AUTH_URL,
  trustedOrigins: config.AUTH_TRUSTED_ORIGINS,
  ids,
  secureCookies: config.BETTER_AUTH_URL.startsWith('https:'),
  onLog: () => undefined,
});
const database = createDatabase({ url: config.DATABASE_URL, ids });
const app = await createApp(
  { readiness: [], auth: { service: auth, baseURL: config.BETTER_AUTH_URL }, database, ids },
  { logger: createLogger('warn') },
);
try {
  const written = await createDemoData({
    app,
    auth,
    origin,
    planId: PROVISIONAL_PLAN_ID,
    ...demoReads(owner),
    grant: async (email) => {
      const request = { email, permission: 'create:companies:platform', operator: 'demo-data' };
      await grantPlatformPermission(ownerUrl, request, ids);
    },
  });
  console.log('demo data complete; rows created this run:', written);
} finally {
  await app.close();
  await Promise.all([database.close(), auth.close(), owner.end()]);
}
