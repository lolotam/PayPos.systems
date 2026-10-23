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
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/synthetic';
const P256DH = 'p'.repeat(87);
const AUTH = 'a'.repeat(22);
const KEY_ID = '0123456789abcdef';
const SUBSCRIPTION = '01920000-0000-7000-8000-0000000000d1';

const digest = (label: string) => createHash('sha256').update(label).digest();
const asA = (query: SQL) => db.withTenant(A.company, (tx) => tx.execute(query));

const live = sql`INSERT INTO push_subscriptions(company_id,id,user_id,installation_hash,endpoint,p256dh,auth,
    endpoint_hash,delivery_token,generation,locale,vapid_key_id,created_at,last_seen_at,updated_at)
  VALUES(${A.company},${SUBSCRIPTION},${USER},${digest(`install:${SUBSCRIPTION}`)},${ENDPOINT},${P256DH},${AUTH},
    ${digest(`endpoint:${SUBSCRIPTION}`)},${ids.newId()},1,'ar',${KEY_ID},now(),now(),now())`;

type AttemptState = {
  id?: string;
  status?: string;
  businessId?: string | null;
  branchId?: string | null;
  executionId?: string | null;
  sendingAt?: string | null;
  finishedAt?: string | null;
  failureCode?: string | null;
  outcomeKnown?: boolean | null;
};

const attempt = (state: AttemptState = {}) => {
  const row = {
    id: state.id ?? ids.newId(),
    status: state.status ?? 'PENDING',
    businessId: state.businessId ?? null,
    branchId: state.branchId ?? null,
    executionId: state.executionId ?? null,
    sendingAt: state.sendingAt ?? null,
    finishedAt: state.finishedAt ?? null,
    failureCode: state.failureCode ?? null,
    outcomeKnown: state.outcomeKnown ?? null,
  };
  return sql`INSERT INTO push_attempts(company_id,id,subscription_id,subscription_generation,user_id,business_id,branch_id,
      source_event_id,template_key,template_revision,locale,safe_parameters,status,send_deadline,execution_id,sending_at,
      finished_at,failure_code,outcome_known,http_status,created_at,updated_at)
    VALUES(${A.company},${row.id},${SUBSCRIPTION},1,${USER},${row.businessId},${row.branchId},${ids.newId()},
      'shift_not_clocked_in_self',1,'ar','[]'::jsonb,${row.status},null,${row.executionId},${row.sendingAt},
      ${row.finishedAt},${row.failureCode},${row.outcomeKnown},null,now(),now())`;
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user" (id,name,email) VALUES (${USER},'Synthetic user','push-guard@example.test')
    ON CONFLICT DO NOTHING`;
  // سياسات RLS مفعّلة على المالك كمان، فسياق الشركة لازم يكون متظبط على اتصال المالك.
  await owner`SELECT set_config('app.company_id', ${A.company}, false)`;
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  await asA(live);
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

it('refuses to reopen a terminal attempt', async () => {
  const id = ids.newId();
  await asA(attempt({ id }));
  await owner`UPDATE push_attempts SET status='SENDING', execution_id=${ids.newId()}, sending_at=now()
    WHERE id=${id}`;
  await owner`UPDATE push_attempts SET status='SENT', finished_at=now(), outcome_known=true WHERE id=${id}`;
  await rejected(
    owner`UPDATE push_attempts SET status='PENDING' WHERE id=${id}`,
    '23514',
    'terminal',
  );
});

it('refuses to move a sending attempt back to pending', async () => {
  const id = ids.newId();
  await asA(attempt({ id }));
  await owner`UPDATE push_attempts SET status='SENDING', execution_id=${ids.newId()}, sending_at=now()
    WHERE id=${id}`;
  await rejected(
    owner`UPDATE push_attempts SET status='PENDING' WHERE id=${id}`,
    '23514',
    'transition',
  );
});

it('refuses to change the execution of a sending attempt', async () => {
  const id = ids.newId();
  await asA(attempt({ id }));
  await owner`UPDATE push_attempts SET status='SENDING', execution_id=${ids.newId()}, sending_at=now()
    WHERE id=${id}`;
  await rejected(
    owner`UPDATE push_attempts SET execution_id=${ids.newId()} WHERE id=${id}`,
    '23514',
    'execution',
  );
});

it('refuses to change an identity column of a pending attempt', async () => {
  const id = ids.newId();
  await asA(attempt({ id }));
  await rejected(owner`UPDATE push_attempts SET locale='en' WHERE id=${id}`, '23514', 'identity');
  await rejected(
    owner`UPDATE push_attempts SET template_key='other_notice' WHERE id=${id}`,
    '23514',
    'identity',
  );
});

it('refuses an identity change by the application role on the grant alone', async () => {
  const id = ids.newId();
  await asA(attempt({ id }));
  await rejected(asA(sql`UPDATE push_attempts SET locale='en' WHERE id=${id}`), '42501');
});

it('refuses an insert that starts in a terminal state', async () => {
  await rejected(asA(attempt({ status: 'SENT' })), '23514', 'initial');
});

it('refuses a result on a pending attempt', async () => {
  await rejected(asA(attempt({ failureCode: 'PROVIDER_5XX' })), '23514', 'result');
  await rejected(asA(attempt({ outcomeKnown: true })), '23514', 'result');
});

it('refuses a branch that belongs to another business', async () => {
  await rejected(asA(attempt({ branchId: A.branch, businessId: B.business })), '23503');
});

it('walks the allowed path from pending to sent through the granted columns', async () => {
  const id = ids.newId();
  await asA(attempt({ id }));
  await asA(
    sql`UPDATE push_attempts SET status='SENDING', execution_id=${ids.newId()}, sending_at=now()
      WHERE id=${id}`,
  );
  await asA(
    sql`UPDATE push_attempts SET status='SENT', finished_at=now(), outcome_known=true WHERE id=${id}`,
  );
  const [row] = await asA(sql`SELECT status FROM push_attempts WHERE id=${id}`);
  expect(row?.['status']).toBe('SENT');
});

type Failure = { code?: string; message?: string; cause?: Failure };

const detail = (error: unknown) => {
  const failure = error as Failure;
  return {
    code: failure?.cause?.code ?? failure?.code,
    message: failure?.cause?.message ?? failure?.message ?? '',
  };
};

async function rejected(work: Promise<unknown>, code: string, message?: string) {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  const failure = detail(error);
  expect(failure.code).toBe(code);
  if (message !== undefined) expect(failure.message).toContain(message);
}
