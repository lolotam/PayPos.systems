import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';

import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = TENANT;
const OTHER_USER = '01920000-0000-7000-8000-0000000000f2';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/synthetic';
const P256DH = 'p'.repeat(87);
const AUTH = 'a'.repeat(22);
const KEY_ID = '0123456789abcdef';
const SECRETS = ['endpoint', 'p256dh', 'auth', 'delivery_token'] as const;

const digest = (label: string) => createHash('sha256').update(label).digest();
const asA = (query: SQL) => db.withTenant(A.company, (tx) => tx.execute(query));

const live = (
  company: string,
  id: string,
  userId: string,
  options: { installation?: Buffer; endpointHash?: Buffer } = {},
) => sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
    endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at)
  VALUES(${company},${id},${userId},${options.installation ?? digest(`install:${id}`)},${ENDPOINT},${P256DH},
    ${AUTH},${options.endpointHash ?? digest(`endpoint:${id}`)},${ids.newId()},1,'ar',${KEY_ID},now(),now(),now())`;

const revoked = (
  company: string,
  id: string,
  userId: string,
  cleared: readonly (typeof SECRETS)[number][],
) => sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
    endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at,revoked_at,revoked_reason)
  VALUES(${company},${id},${userId},${digest(`install:${id}`)},
    ${cleared.includes('endpoint') ? null : ENDPOINT},
    ${cleared.includes('p256dh') ? null : P256DH},
    ${cleared.includes('auth') ? null : AUTH},
    ${digest(`endpoint:${id}`)},
    ${cleared.includes('delivery_token') ? null : ids.newId()},2,'ar',${KEY_ID},now(),now(),now(),now(),'UNSUBSCRIBED')`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user" (id,name,email) VALUES (${USER},'Synthetic user','push-a@example.test'),
    (${OTHER_USER},'Synthetic other','push-other@example.test') ON CONFLICT DO NOTHING`;
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  await asA(live(A.company, ids.newId(), USER));
  await asA(live(A.company, ids.newId(), OTHER_USER));
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

it('FORCE RLS, no DELETE and a cross-company row is invisible', async () => {
  const [table] =
    await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='push_subscriptions'`;
  expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(await asA(sql`SELECT id FROM push_subscriptions`)).toHaveLength(2);
  expect(
    await db.withTenant(B.company, (tx) => tx.execute(sql`SELECT id FROM push_subscriptions`)),
  ).toHaveLength(0);
  expect(
    await asA(sql`UPDATE push_subscriptions SET locale='en' WHERE company_id=${B.company} RETURNING id`),
  ).toHaveLength(0);
});

it('a cross-company insert and an unknown user are refused', async () => {
  await rejected(asA(live(B.company, ids.newId(), USER)), '42501');
  await rejected(asA(live(A.company, ids.newId(), ids.newId())), '23503');
  await rejected(asA(sql`DELETE FROM push_subscriptions RETURNING id`), '42501');
});

it('the state check refuses every partially cleared revoked row and a live row with a reason', async () => {
  for (let mask = 0; mask < 16; mask += 1) {
    const cleared = SECRETS.filter((_, bit) => (mask & (1 << bit)) !== 0);
    if (cleared.length === 0) continue;
    await rejected(
      asA(revoked(A.company, ids.newId(), USER, cleared)),
      '23514',
      'push_subscriptions_state',
    );
  }
  await rejected(
    asA(sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
      endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at,revoked_reason)
      VALUES(${A.company},${ids.newId()},${USER},${digest('live-with-reason')},${ENDPOINT},${P256DH},${AUTH},
        ${digest('endpoint:live-with-reason')},${ids.newId()},1,'ar',${KEY_ID},now(),now(),now(),'GONE')`),
    '23514',
    'push_subscriptions_state',
  );
  await asA(revoked(A.company, ids.newId(), USER, SECRETS));
});

it('one live row per endpoint and per install, and a revoked row frees both', async () => {
  const endpointHash = digest('endpoint:shared');
  await asA(live(A.company, ids.newId(), USER, { endpointHash }));
  await rejected(
    asA(live(A.company, ids.newId(), OTHER_USER, { endpointHash })),
    '23505',
    'push_subscriptions_endpoint_key',
  );
  const installation = digest('install:shared');
  await asA(live(A.company, ids.newId(), USER, { installation }));
  await rejected(
    asA(live(A.company, ids.newId(), USER, { installation })),
    '23505',
    'push_subscriptions_install_key',
  );
  await asA(
    sql`UPDATE push_subscriptions SET revoked_at=now(),revoked_reason='UNSUBSCRIBED',endpoint=NULL,p256dh=NULL,
      auth=NULL,delivery_token=NULL,generation=generation+1 WHERE endpoint_hash=${endpointHash}`,
  );
  await asA(live(A.company, ids.newId(), OTHER_USER, { endpointHash }));
});

it('the revoked reason set and the locale set are closed', async () => {
  await rejected(
    asA(sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
      endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at)
      VALUES(${A.company},${ids.newId()},${USER},${digest('bad-locale')},${ENDPOINT},${P256DH},${AUTH},
        ${digest('endpoint:bad-locale')},${ids.newId()},1,'fr',${KEY_ID},now(),now(),now())`),
    '23514',
    'push_subscriptions_locale',
  );
  await rejected(
    asA(sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
      endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at,revoked_at,revoked_reason)
      VALUES(${A.company},${ids.newId()},${USER},${digest('bad-reason')},${ENDPOINT},${P256DH},${AUTH},
        ${digest('endpoint:bad-reason')},${ids.newId()},1,'ar',${KEY_ID},now(),now(),now(),now(),'WHATEVER')`),
    '23514',
    'push_subscriptions_revoked_reason',
  );
});

async function rejected(work: Promise<unknown>, code: string, constraint?: string) {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: { code: string; constraint_name?: string } }).cause;
  expect(cause?.code).toBe(code);
  if (constraint !== undefined) expect(cause?.constraint_name).toBe(constraint);
}
