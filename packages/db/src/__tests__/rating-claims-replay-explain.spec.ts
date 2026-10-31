import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createOutboxDispatcherDatabase, type OutboxDispatcherDatabase } from '../dispatcher.ts';
import { ratingClaimsDiscoveryEventId } from '../rating-claims-discovery-id.ts';

const capture = vi.hoisted(() => ({
  enabled: false,
  statements: [] as { query: string; parameters: postgres.ParameterOrJSON<never>[] }[],
}));

// نلتقط SQL الفعلي لإثبات أن replay يستخدم الفهارس الحالية بلا grant أو فهرس جديد.
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

let testDb: TestDatabase;
let owner: postgres.Sql;
let replayConnection: postgres.Sql;
let dispatcher: OutboxDispatcherDatabase;
const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const discoveryId = ratingClaimsDiscoveryEventId(TENANT.A.company);

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  replayConnection = postgres(testDb.dispatcherUrl, { max: 1, onnotice: () => undefined });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl, maxConnections: 1 });
  for (const company of [TENANT.A.company, TENANT.B.company]) {
    await owner`INSERT INTO outbox(company_id,id,aggregate_type,aggregate_id,event_type,payload,published_at)
      SELECT ${company}, ('01970000-0000-7000-8000-' || lpad(n::text,12,'0'))::uuid,
        'service_session', ${TENANT.A.business}, 'BusinessCreated', '{}'::jsonb, clock_timestamp()
      FROM generate_series(1,20000) AS n`;
  }
  await owner`UPDATE outbox SET event_type='ServiceSessionRecorded' WHERE company_id=${TENANT.A.company} AND id=${eventId(5000)}`;
  await owner`UPDATE outbox SET event_type='ServiceLineChanged', attempts=4 WHERE company_id=${TENANT.A.company} AND id=${eventId(15000)}`;
  await owner`UPDATE outbox SET event_type='SalaryChanged' WHERE company_id=${TENANT.A.company} AND id=${eventId(17500)}`;
  await owner`UPDATE outbox SET event_type='ServiceSessionRecorded' WHERE company_id=${TENANT.B.company} AND id=${eventId(3000)}`;
  await owner`INSERT INTO outbox(company_id,id,aggregate_type,aggregate_id,event_type,payload,attempts,parked_at)
    VALUES(${TENANT.A.company},${discoveryId},'company',${TENANT.A.company},
      'RatingClaimsDiscoveryRequested',${owner.json({ company_id: TENANT.A.company })},10,clock_timestamp())`;
  await owner`ANALYZE outbox`;
  capture.enabled = true;
  try {
    await dispatcher.ratingClaimsVisitReplayPage(TENANT.A.company, null, null, 1);
    await dispatcher.ratingClaimsVisitReplayPage(
      TENANT.A.company,
      eventId(5000),
      eventId(15000),
      1,
    );
    await dispatcher.ratingClaimsDiscoveryReplay(TENANT.A.company);
  } finally {
    capture.enabled = false;
  }
  expect(capture.statements).toHaveLength(4);
});

afterAll(async () => {
  await dispatcher?.close();
  await replayConnection?.end();
  await owner?.end();
  await testDb?.drop();
});

it.each([0, 1, 2])(
  'rating visit replay statement %s uses the existing partial replay index',
  async (position) => {
    const statement = capture.statements[position];
    if (statement === undefined) throw new Error('REPLAY_STATEMENT_MISSING');
    const plan = await replayConnection.unsafe(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.query}`,
      statement.parameters,
    );
    const text = JSON.stringify(plan);
    expect(text).toContain('outbox_commission_input_replay_idx');
    expect(text).not.toContain('Seq Scan');
    expect(text).not.toContain('"Node Type":"Sort"');
  },
);

it('returns only the company visit triggers and reads the parked discovery by its primary key', async () => {
  const visits = await dispatcher.ratingClaimsVisitReplayPage(TENANT.A.company, null, null, 10);
  expect(visits.throughId).toBe(eventId(15000));
  expect(visits.events.map((event) => event.id)).toEqual([eventId(5000), eventId(15000)]);
  expect(visits.events.every((event) => event.companyId === TENANT.A.company)).toBe(true);
  expect(visits.events.map((event) => event.eventType)).not.toContain('SalaryChanged');
  expect(visits.events[1]?.attempt).toBe(4);

  const discovery = await dispatcher.ratingClaimsDiscoveryReplay(TENANT.A.company);
  expect(discovery).toMatchObject({
    id: discoveryId,
    companyId: TENANT.A.company,
    eventType: 'RatingClaimsDiscoveryRequested',
    payload: { company_id: TENANT.A.company },
    attempt: 10,
  });
  const statement = capture.statements[3];
  if (statement === undefined) throw new Error('DISCOVERY_STATEMENT_MISSING');
  const plan = await replayConnection.unsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.query}`,
    statement.parameters,
  );
  expect(JSON.stringify(plan)).toContain('outbox_pkey');
});
