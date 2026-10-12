import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createOutboxDispatcherDatabase, type OutboxDispatcherDatabase } from '../index.ts';

const capture = vi.hoisted(() => ({
  enabled: false,
  statements: [] as { query: string; parameters: postgres.ParameterOrJSON<never>[] }[],
}));

// نختبر SQL الذي ينفذه المسار نفسه حتى لا تنجح نسخة اختبار قديمة بعد تغيير الاستعلام.
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

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  replayConnection = postgres(testDb.dispatcherUrl, { max: 1, onnotice: () => undefined });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl, maxConnections: 1 });
  // حدثان نادران بين أحداث منشورة كثيرة، مع صفوف غير مطابقة قبل آخر حدث وبعده.
  for (const company of [TENANT.A.company, TENANT.B.company]) {
    await owner`INSERT INTO outbox(company_id,id,aggregate_type,aggregate_id,event_type,payload,published_at)
      SELECT ${company}, ('01970000-0000-7000-8000-' || lpad(n::text,12,'0'))::uuid,
        'service_session', ${TENANT.A.business},
        CASE WHEN ${company}::uuid = ${TENANT.A.company}::uuid AND n=5000 THEN 'ServiceSessionRecorded'
          WHEN ${company}::uuid = ${TENANT.A.company}::uuid AND n=15000 THEN 'ServiceSessionLinesAdded'
          ELSE 'BusinessCreated' END, '{}'::jsonb, clock_timestamp()
      FROM generate_series(1,20000) AS n`;
  }
  await owner`ANALYZE outbox`;
  capture.enabled = true;
  try {
    const first = await dispatcher.serviceSessionReplayPage(TENANT.A.company, null, null, 1);
    expect(first.throughId).toBe(eventId(15000));
    expect(first.events.map((event) => event.id)).toEqual([eventId(5000)]);
    const next = await dispatcher.serviceSessionReplayPage(
      TENANT.A.company,
      eventId(5000),
      first.throughId,
      1,
    );
    expect(next.events.map((event) => event.id)).toEqual([eventId(15000)]);
    expect(await dispatcher.serviceSessionReplayPage(TENANT.B.company, null, null, 1)).toEqual({
      throughId: null,
      events: [],
    });
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

it.each(
  ['high-water mark', 'first page', 'cursor page', 'tenant without service events'].map(
    (name, position) => ({ name, position }),
  ),
)(
  '$name uses the partial replay index with default planner settings and LIMIT 1',
  async ({ position }) => {
    const statement = capture.statements[position];
    if (statement === undefined) throw new Error('REPLAY_STATEMENT_MISSING');
    const plan = await replayConnection.unsafe(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.query}`,
      statement.parameters,
    );
    const text = JSON.stringify(plan);
    expect(text).toContain('outbox_service_session_replay_idx');
    expect(text).not.toContain('Seq Scan');
    expect(text).not.toContain('"Node Type":"Sort"');
    expect(text).not.toMatch(/"Rows Removed by Filter":[1-9]/);
  },
);
