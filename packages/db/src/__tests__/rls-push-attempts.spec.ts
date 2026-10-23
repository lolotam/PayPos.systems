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
const SUBSCRIPTION_A = '01920000-0000-7000-8000-0000000000d1';
const SUBSCRIPTION_B = '01920000-0000-7000-8000-0000000000d2';
const SUBSCRIPTION_A2 = '01920000-0000-7000-8000-0000000000d3';

const digest = (label: string) => createHash('sha256').update(label).digest();
const asA = (query: SQL) => db.withTenant(A.company, (tx) => tx.execute(query));

const live = (
  company: string,
  id: string,
  userId: string,
) => sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
    endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at)
  VALUES(${company},${id},${userId},${digest(`install:${id}`)},${ENDPOINT},${P256DH},${AUTH},
    ${digest(`endpoint:${id}`)},${ids.newId()},1,'ar',${KEY_ID},now(),now(),now())`;

type AttemptState = {
  id?: string;
  subscriptionId?: string;
  sourceEventId?: string;
  templateKey?: string;
  status?: string;
  executionId?: string | null;
  sendingAt?: string | null;
  finishedAt?: string | null;
  failureCode?: string | null;
  outcomeKnown?: boolean | null;
};

const attempt = (company: string, state: AttemptState = {}) => {
  const row = {
    id: state.id ?? ids.newId(),
    subscriptionId: state.subscriptionId ?? SUBSCRIPTION_A,
    sourceEventId: state.sourceEventId ?? ids.newId(),
    templateKey: state.templateKey ?? 'shift_not_clocked_in_self',
    status: state.status ?? 'PENDING',
    executionId: state.executionId ?? null,
    sendingAt: state.sendingAt ?? null,
    finishedAt: state.finishedAt ?? null,
    failureCode: state.failureCode ?? null,
    outcomeKnown: state.outcomeKnown ?? null,
  };
  return sql`INSERT INTO push_attempts(company_id,id,subscription_id,subscription_generation,user_id,business_id,branch_id,
      source_event_id,template_key,template_revision,locale,safe_parameters,status,send_deadline,execution_id,sending_at,
      finished_at,failure_code,outcome_known,http_status,created_at,updated_at)
    VALUES(${company},${row.id},${row.subscriptionId},1,${USER},null,null,${row.sourceEventId},${row.templateKey},1,'ar',
      '[]'::jsonb,${row.status},null,${row.executionId},${row.sendingAt},${row.finishedAt},${row.failureCode},${row.outcomeKnown},
      null,now(),now())`;
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user" (id,name,email) VALUES (${USER},'Synthetic user','push-a@example.test'),
    (${OTHER_USER},'Synthetic other','push-other@example.test') ON CONFLICT DO NOTHING`;
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  await asA(live(A.company, SUBSCRIPTION_A, USER));
  await asA(live(A.company, SUBSCRIPTION_A2, OTHER_USER));
  await db.withTenant(B.company, (tx) => tx.execute(live(B.company, SUBSCRIPTION_B, USER)));
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

it('FORCE RLS, no DELETE and a cross-company row is invisible', async () => {
  const [table] =
    await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='push_attempts'`;
  expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  expect(await asA(sql`SELECT id FROM push_attempts`)).toHaveLength(0);
  expect(
    await db.withTenant(B.company, (tx) => tx.execute(sql`SELECT id FROM push_attempts`)),
  ).toHaveLength(0);
  await rejected(asA(sql`DELETE FROM push_attempts RETURNING id`), '42501');
});

it('a cross-company insert and a foreign-company subscription are refused', async () => {
  await rejected(asA(attempt(B.company, { subscriptionId: SUBSCRIPTION_B })), '42501');
  await rejected(asA(attempt(A.company, { subscriptionId: SUBSCRIPTION_B })), '23503');
});

it('the state check refuses a broken row', async () => {
  await rejected(
    asA(attempt(A.company, { status: 'PENDING', finishedAt: new Date().toISOString() })),
    '23514',
    'push_attempts_state',
  );
  await rejected(
    asA(attempt(A.company, { status: 'SENDING', sendingAt: new Date().toISOString() })),
    '23514',
    'push_attempts_state',
  );
  await rejected(
    asA(attempt(A.company, { status: 'SENT', outcomeKnown: true })),
    '23514',
    'push_attempts_state',
  );
  await rejected(
    asA(
      attempt(A.company, {
        status: 'SENT',
        finishedAt: new Date().toISOString(),
        outcomeKnown: true,
        failureCode: 'PROVIDER_5XX',
      }),
    ),
    '23514',
    'push_attempts_outcome',
  );
  await rejected(
    asA(
      attempt(A.company, {
        status: 'FAILED',
        finishedAt: new Date().toISOString(),
        outcomeKnown: true,
      }),
    ),
    '23514',
    'push_attempts_outcome',
  );
});

it('the state check accepts one valid row of each status', async () => {
  const now = new Date().toISOString();
  const sourceEventId = ids.newId();
  await asA(attempt(A.company, { sourceEventId, status: 'PENDING' }));
  await asA(
    attempt(A.company, {
      sourceEventId,
      status: 'SENDING',
      executionId: ids.newId(),
      sendingAt: now,
    }),
  );
  await asA(
    attempt(A.company, { sourceEventId, status: 'SENT', finishedAt: now, outcomeKnown: true }),
  );
  await asA(
    attempt(A.company, {
      sourceEventId,
      status: 'FAILED',
      finishedAt: now,
      outcomeKnown: true,
      failureCode: 'PROVIDER_5XX',
    }),
  );
  await asA(
    attempt(A.company, {
      sourceEventId,
      status: 'EXPIRED',
      finishedAt: now,
      outcomeKnown: true,
      failureCode: 'DEADLINE_EXPIRED',
    }),
  );
  const rows = await asA(
    sql`SELECT status FROM push_attempts WHERE source_event_id = ${sourceEventId}`,
  );
  expect(rows).toHaveLength(5);
  expect(rows.map((row) => row['status']).sort()).toEqual([
    'EXPIRED',
    'FAILED',
    'PENDING',
    'SENDING',
    'SENT',
  ]);
});

it('the identity key refuses a second attempt for the same source event, subscription and template', async () => {
  const sourceEventId = ids.newId();
  await asA(attempt(A.company, { sourceEventId, subscriptionId: SUBSCRIPTION_A }));
  await rejected(
    asA(attempt(A.company, { sourceEventId, subscriptionId: SUBSCRIPTION_A })),
    '23505',
    'push_attempts_identity',
  );
  await asA(attempt(A.company, { sourceEventId, subscriptionId: SUBSCRIPTION_A2 }));
  await asA(
    attempt(A.company, {
      sourceEventId,
      subscriptionId: SUBSCRIPTION_A,
      templateKey: 'other_notice',
    }),
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
