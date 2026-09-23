import { createAuth } from '@pospay/auth';
import { PROVISIONAL_PLAN_ID, createDatabase, grantPlatformPermission } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';

import { createApp } from '../src/app.ts';
import { readConfig } from '../src/shared/config.ts';
import { DEMO_OPERATOR, createDemoData } from './demo-data.ts';

// pnpm --filter @pospay/api demo:seed — the demo companies of plan v4 T8, once, on the dev database. It needs the
// API's own environment plus MIGRATION_DATABASE_URL (the operator connection that grants platform permissions).
const config = readConfig(process.env);
const ownerUrl = process.env['MIGRATION_DATABASE_URL'];
if (ownerUrl === undefined || ownerUrl === '') {
  throw new Error('MIGRATION_DATABASE_URL is not set — see .env.example');
}
const origin = config.AUTH_TRUSTED_ORIGINS[0];
if (origin === undefined) throw new Error('AUTH_TRUSTED_ORIGINS needs at least one origin');

const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
const [existing] = await owner`SELECT 1 FROM "user" WHERE email = ${DEMO_OPERATOR}`;
await owner.end();
if (existing !== undefined) {
  console.log('demo data already present — nothing written');
} else {
  const ids = systemUuidV7();
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
    const companies = await createDemoData({
      app,
      auth,
      origin,
      planId: PROVISIONAL_PLAN_ID,
      grant: async (email) => {
        const request = { email, permission: 'create:companies:platform', operator: 'demo-data' };
        await grantPlatformPermission(ownerUrl, request, ids);
      },
    });
    console.log('demo companies created:', companies.length);
  } finally {
    await app.close();
    await Promise.all([database.close(), auth.close()]);
  }
}
