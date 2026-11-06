import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  createDatabase,
  createOutboxDispatcherDatabase,
  type Database,
  type OutboxDispatcherDatabase,
} from '../index.ts';
import { discoverRatingClaims } from '../data-steps/rating-claims-discovery.ts';
import { migrationDataSteps } from '../data-steps/index.ts';
import { readPgTestEnv } from '../../test/pg-env.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import {
  seedRatingTenants,
  RATING_TENANT,
  insertRequest,
  claimRequest,
} from '../../test/rating-fixtures.ts';

const capture = vi.hoisted(() => ({
  enabled: false,
  statements: [] as { query: string; parameters: postgres.ParameterOrJSON<never>[] }[],
}));
// نلتقط SQL الفعلي من واجهة replay، ثم نفحص خطته بالدور المقيد نفسه.
vi.mock('postgres', async (importOriginal) => {
  const original = await importOriginal<{ default: typeof postgres }>();
  return {
    ...original,
    default: (url: string, options: object) =>
      original.default(url, {
        ...options,
        debug: (
          _connection: number,
          query: string,
          parameters: postgres.ParameterOrJSON<never>[],
        ) => {
          if (capture.enabled && /SELECT[\s\S]*FROM outbox/.test(query))
            capture.statements.push({ query, parameters: [...parameters] });
        },
      }),
  };
});

const ids = systemUuidV7();
let testDb: TestDatabase;
let owner: postgres.Sql;
let app: Database;
let dispatcher: OutboxDispatcherDatabase;
const { A, B } = RATING_TENANT;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  app = createDatabase({ url: testDb.appUrl, ids });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
  const draft = await readFile(
    new URL(
      '../../../../docs/specs/060-ratings-and-staff-app/59b-2c-migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await owner.unsafe(draft);
  await app.withTenant(A.company, async (tx) => {
    await insertRequest(tx, { tenant: A, date: '2026-06-01' });
    const requestId = await insertRequest(tx, { tenant: A, date: '2026-06-02' });
    await claimRequest(tx, {
      tenant: A,
      requestId,
      tokenHash: Buffer.alloc(32, 7),
      readyEventId: ids.newId(),
      now: '2026-06-02T00:00:00Z',
      performers: [A.employees[0]],
    });
  });
  await app.withTenant(B.company, (tx) => insertRequest(tx, { tenant: B }));
  await app.withTenant(A.company, async (tx) => {
    const requestId = await insertRequest(tx, { tenant: A, date: '2026-06-03' });
    await claimRequest(tx, {
      tenant: A,
      requestId,
      tokenHash: Buffer.alloc(32, 9),
      readyEventId: ids.newId(),
      now: '2026-06-03T00:00:00Z',
      performers: [A.employees[0]],
    });
  });
  await owner`UPDATE rating_requests SET status='SENT',sent_at=claimed_at
    WHERE company_id=${A.company} AND business_date='2026-06-03'`;
  await owner`INSERT INTO notification_attempts(company_id,id,source_event_id,channel,template_key,
    template_revision,locale,recipient_hash,hash_key_id,phone_last3,safe_parameters,status,
    authorized_at,finished_at,failure_code,created_at,updated_at)
    VALUES (${A.company},${ids.newId()},${ids.newId()},'whatsapp','rating_request',1,'ar',
      ${Buffer.alloc(32, 8)},'synthetic','001','[]','FAILED',now(),now(),'CONFIG_INVALID',now(),now())`;
});

beforeEach(async () => {
  await owner`DELETE FROM outbox`;
});

afterAll(async () => {
  await dispatcher?.close();
  await app?.close();
  await owner?.end();
  await testDb?.drop();
});

it('inventories both tenants, emits isolated discovery once and leaves historical sends unchanged', async () => {
  const before = await historicalRows();
  const result = await discoverRatingClaims(owner, app, dispatcher);
  expect(result).toEqual({
    companies: 2,
    scheduled: 2,
    sending: 1,
    sent: 1,
    historicalAttempts: 1,
    discoveryEvents: 2,
  });
  expect(await historicalRows()).toEqual(before);
  const events = await owner`SELECT company_id,aggregate_type,aggregate_id,event_type,payload
    FROM outbox WHERE event_type='RatingClaimsDiscoveryRequested' ORDER BY company_id`;
  expect(events.map((event) => ({ ...event }))).toEqual(
    [A, B].map((tenant) => ({
      company_id: tenant.company,
      aggregate_type: 'rating_claims_discovery',
      aggregate_id: tenant.company,
      event_type: 'RatingClaimsDiscoveryRequested',
      payload: {},
    })),
  );
  await owner`UPDATE outbox SET parked_at=now(),attempts=10,last_error='synthetic'
    WHERE event_type='RatingClaimsDiscoveryRequested'`;
  const parked = await owner`SELECT row_to_json(o)::text AS snapshot FROM outbox o ORDER BY id`;
  expect((await discoverRatingClaims(owner, app, dispatcher)).discoveryEvents).toBe(0);
  expect(await owner`SELECT row_to_json(o)::text AS snapshot FROM outbox o ORDER BY id`).toEqual(
    parked,
  );
});

it('refuses an application role instead of silently seeing no companies', async () => {
  const restricted = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(discoverRatingClaims(restricted, app, dispatcher)).rejects.toThrow(
      'RATING_CLAIMS_DISCOVERY_MIGRATION_ROLE_REFUSED',
    );
  } finally {
    await restricted.end();
  }
});

it('counts a company without scheduled work without emitting a discovery event for it', async () => {
  const emptyCompany = ids.newId();
  await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id)
    SELECT ${emptyCompany},'Synthetic empty company',owner_user_id,plan_id FROM companies WHERE id=${A.company}`;
  try {
    const counts = await discoverRatingClaims(owner, app, dispatcher);
    expect(counts).toMatchObject({
      companies: 3,
      scheduled: 2,
      sending: 1,
      sent: 1,
      discoveryEvents: 2,
    });
    expect(await dispatcher.ratingClaimsDiscoveryExists(A.company)).toBe(true);
    expect(await dispatcher.ratingClaimsDiscoveryExists(emptyCompany)).toBe(false);
  } finally {
    await owner`DELETE FROM companies WHERE id=${emptyCompany}`;
  }
});

it('the registered migration step uses existing restricted credentials and logs only inventory counts', async () => {
  const env = readPgTestEnv();
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    const steps = migrationDataSteps(testDb.ownerUrl, env.appPassword, env.dispatcherPassword);
    await steps['rating-claims-discovery'](owner);
    expect(log.mock.calls).toEqual([
      [
        `rating_claims_discovery ${JSON.stringify({
          companies: 2,
          scheduled: 2,
          sending: 1,
          sent: 1,
          historicalAttempts: 1,
          discoveryEvents: 2,
        })}`,
      ],
    ]);
    expect(await dispatcher.ratingClaimsDiscoveryExists(A.company)).toBe(true);
    expect(await dispatcher.ratingClaimsDiscoveryExists(B.company)).toBe(true);
  } finally {
    log.mockRestore();
  }
});

it('restarts after a committed company transaction loses its reply without duplicate discovery', async () => {
  const lostReply: Pick<Database, 'withTenant'> = {
    withTenant: async (companyId, callback, options) => {
      await app.withTenant(companyId, callback, options);
      throw new Error('SYNTHETIC_COMMIT_REPLY_LOST');
    },
  };
  await expect(discoverRatingClaims(owner, lostReply, dispatcher)).rejects.toThrow(
    'SYNTHETIC_COMMIT_REPLY_LOST',
  );
  expect((await discoverRatingClaims(owner, app, dispatcher)).discoveryEvents).toBe(1);
  const rows =
    await owner`SELECT company_id,count(*)::int AS count FROM outbox GROUP BY company_id ORDER BY company_id`;
  expect(rows.map((row) => ({ ...row }))).toEqual([
    { company_id: A.company, count: 1 },
    { company_id: B.company, count: 1 },
  ]);
});

it('replays only scoped discovery and visit sources, including parked and published, without any metadata write', async () => {
  await discoverRatingClaims(owner, app, dispatcher);
  await owner`UPDATE outbox SET parked_at=now(),attempts=10`;
  const oldVisit = ids.newId();
  const otherEvent = ids.newId();
  await owner`INSERT INTO outbox(company_id,id,aggregate_type,aggregate_id,event_type,payload,published_at)
    VALUES (${A.company},${oldVisit},'service_session',${ids.newId()},'ServiceLineChanged','{}',now()),
      (${A.company},${otherEvent},'rating_request',${ids.newId()},'RatingRequestReady','{}',now())`;
  const before = await owner`SELECT row_to_json(o)::text AS snapshot FROM outbox o ORDER BY id`;
  const page = await dispatcher.ratingClaimsReplayPage(A.company, null, null, 100);
  expect(page.events.map((event) => event.eventType).sort()).toEqual([
    'RatingClaimsDiscoveryRequested',
    'ServiceLineChanged',
  ]);
  expect(page.events.every((event) => event.companyId === A.company)).toBe(true);
  expect(
    page.events.find((event) => event.eventType === 'RatingClaimsDiscoveryRequested')?.attempt,
  ).toBe(10);
  expect((await dispatcher.ratingClaimsReplayPage(B.company, null, null, 100)).events).toHaveLength(
    1,
  );
  expect(
    (await dispatcher.ratingClaimsReplayPage(A.company, page.throughId, page.throughId, 100))
      .events,
  ).toEqual([]);
  expect(await owner`SELECT row_to_json(o)::text AS snapshot FROM outbox o ORDER BY id`).toEqual(
    before,
  );
});

it('uses the replay index with a representative unrelated retained history', async () => {
  await discoverRatingClaims(owner, app, dispatcher);
  await owner`INSERT INTO outbox(company_id,id,aggregate_type,aggregate_id,event_type,payload,published_at)
    SELECT ${A.company}, ('01980000-0000-7000-8000-' || lpad(n::text,12,'0'))::uuid,
      'company',${A.company},'CompanyCreated','{}',now() FROM generate_series(1,20000) n`;
  await owner`ANALYZE outbox`;
  capture.statements.length = 0;
  capture.enabled = true;
  try {
    await dispatcher.ratingClaimsReplayPage(A.company, null, null, 100);
  } finally {
    capture.enabled = false;
  }
  expect(capture.statements).toHaveLength(2);
  const scoped = postgres(testDb.dispatcherUrl, { max: 1, onnotice: () => undefined });
  try {
    for (const statement of capture.statements) {
      const plan = await scoped.unsafe(
        `EXPLAIN (FORMAT JSON) ${statement.query}`,
        statement.parameters,
      );
      expect(JSON.stringify(plan)).toContain('outbox_rating_claims_replay_idx');
    }
  } finally {
    await scoped.end();
  }
});

async function historicalRows() {
  return {
    requests:
      await owner`SELECT row_to_json(r)::text AS snapshot FROM rating_requests r ORDER BY company_id,id`,
    attempts:
      await owner`SELECT row_to_json(a)::text AS snapshot FROM notification_attempts a ORDER BY company_id,id`,
  };
}
