import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../client.ts';
import {
  discoverRatingClaims,
  RatingClaimsDiscoveryRoleRefusedError,
} from '../data-steps/rating-claims-discovery.ts';
import { createOutboxDispatcherDatabase, type OutboxDispatcherDatabase } from '../dispatcher.ts';

let testDb: TestDatabase, owner: postgres.Sql, app: Database;
let dispatcher: OutboxDispatcherDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  await seedOrders(owner);
  app = createDatabase({ url: testDb.appUrl, ids: systemUuidV7(), maxConnections: 2 });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl, maxConnections: 1 });
});
beforeEach(async () => {
  await owner`DELETE FROM rating_requests WHERE company_id = ${TENANT.A.company}`;
  await owner`DELETE FROM outbox WHERE company_id = ${TENANT.A.company}`;
});
afterAll(async () => {
  await dispatcher?.close();
  await app?.close();
  await owner?.end();
  await testDb?.drop();
});

async function scheduleRequest(): Promise<string> {
  const requestId = systemUuidV7().newId();
  await owner`INSERT INTO rating_requests
      (company_id,id,business_id,customer_id,business_date,branch_id,due_at,status)
    VALUES(${TENANT.A.company},${requestId},${TENANT.A.business},${ORDER_IDS.customer},
      '2026-06-01'::date,${TENANT.A.branch},'2026-06-01T13:10:00Z'::timestamptz,'SCHEDULED')`;
  return requestId;
}

it('discovers every company that still has an unclaimed request', async () => {
  await scheduleRequest();
  expect(await discoverRatingClaims(owner, app)).toEqual({ companies: 2, discovered: 1 });
  const events = await owner`SELECT event_type, payload FROM outbox
    WHERE company_id = ${TENANT.A.company} AND event_type = 'RatingClaimsDiscoveryRequested'`;
  expect(events).toHaveLength(1);
  expect(events[0]?.['payload']).toEqual({ company_id: TENANT.A.company });
});

it('sends nothing for a company without an unclaimed request', async () => {
  expect(await discoverRatingClaims(owner, app)).toEqual({ companies: 2, discovered: 0 });
  const events =
    await owner`SELECT id FROM outbox WHERE event_type = 'RatingClaimsDiscoveryRequested'`;
  expect(events).toHaveLength(0);
});

it('sends one event per company even when it has many requests', async () => {
  await scheduleRequest();
  await owner`INSERT INTO rating_requests
      (company_id,id,business_id,customer_id,business_date,branch_id,due_at,status)
    VALUES(${TENANT.A.company},${systemUuidV7().newId()},${TENANT.A.business},${ORDER_IDS.customer},
      '2026-06-02'::date,${TENANT.A.branch},'2026-06-02T13:10:00Z'::timestamptz,'SCHEDULED')`;
  expect(await discoverRatingClaims(owner, app)).toEqual({ companies: 2, discovered: 1 });
  const events =
    await owner`SELECT id FROM outbox WHERE event_type = 'RatingClaimsDiscoveryRequested'`;
  expect(events).toHaveLength(1);
});

it('does not append a second discovery event when the data step reruns after a crash', async () => {
  await scheduleRequest();
  expect(await discoverRatingClaims(owner, app)).toEqual({ companies: 2, discovered: 1 });
  expect(await discoverRatingClaims(owner, app)).toEqual({ companies: 2, discovered: 0 });
  const events = await owner`SELECT id FROM outbox
    WHERE company_id = ${TENANT.A.company} AND event_type = 'RatingClaimsDiscoveryRequested'`;
  expect(events).toHaveLength(1);
});

it('appends one discovery event when two migration retries race', async () => {
  await scheduleRequest();
  const runs = await Promise.all([
    discoverRatingClaims(owner, app),
    discoverRatingClaims(owner, app),
  ]);
  expect(runs.map((run) => run.discovered).sort()).toEqual([0, 1]);
  const events = await owner`SELECT id FROM outbox
    WHERE company_id = ${TENANT.A.company} AND event_type = 'RatingClaimsDiscoveryRequested'`;
  expect(events).toHaveLength(1);
});

it('replays late visits and the stored discovery through the dispatcher without changing outbox rows', async () => {
  const visitId = systemUuidV7().newId();
  await owner`INSERT INTO outbox
      (company_id,id,aggregate_type,aggregate_id,event_type,payload,published_at)
    VALUES
      (${TENANT.A.company},${visitId},'service_session',${ORDER_IDS.session},
       'ServiceSessionRecorded','{}'::jsonb,clock_timestamp()),
      (${TENANT.A.company},${systemUuidV7().newId()},'employee',${ORDER_IDS.employee},
       'SalaryChanged','{}'::jsonb,clock_timestamp()),
      (${TENANT.B.company},${systemUuidV7().newId()},'service_session',${ORDER_IDS.session},
       'ServiceSessionRecorded','{}'::jsonb,clock_timestamp())`;
  await scheduleRequest();
  await discoverRatingClaims(owner, app);
  const before = await owner`SELECT id,published_at,attempts,next_attempt_at,parked_at
    FROM outbox WHERE company_id = ${TENANT.A.company} ORDER BY id`;

  const visits = await dispatcher.ratingClaimsVisitReplayPage(TENANT.A.company, null, null, 10);
  expect(visits.events.map((event) => event.id)).toEqual([visitId]);
  expect(visits.events[0]).toMatchObject({
    companyId: TENANT.A.company,
    eventType: 'ServiceSessionRecorded',
    attempt: 1,
  });
  const discovery = await dispatcher.ratingClaimsDiscoveryReplay(TENANT.A.company);
  expect(discovery).toMatchObject({
    companyId: TENANT.A.company,
    eventType: 'RatingClaimsDiscoveryRequested',
    payload: { company_id: TENANT.A.company },
    attempt: 1,
  });
  const after = await owner`SELECT id,published_at,attempts,next_attempt_at,parked_at
    FROM outbox WHERE company_id = ${TENANT.A.company} ORDER BY id`;
  expect(after).toEqual(before);
});

it('refuses a migration role without BYPASSRLS before reading any company', async () => {
  await scheduleRequest();
  const restricted = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    const failure = discoverRatingClaims(restricted, app);
    await expect(failure).rejects.toBeInstanceOf(RatingClaimsDiscoveryRoleRefusedError);
    await expect(failure).rejects.toThrow(
      'Migration data step rating-claims-discovery needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
    await expect(failure).rejects.not.toThrow(/postgres:|pospay_app|password/i);
  } finally {
    await restricted.end();
  }
  const events =
    await owner`SELECT id FROM outbox WHERE event_type = 'RatingClaimsDiscoveryRequested'`;
  expect(events).toHaveLength(0);
});
