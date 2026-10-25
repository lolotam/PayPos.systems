import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import {
  createOutboxDispatcherDatabase,
  PROVISIONAL_PLAN_ID,
  type ClaimedEvent,
  type OutboxDispatcherDatabase,
} from '../index.ts';

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

interface TargetEvent {
  readonly n: number;
  readonly type: string;
  readonly published: boolean;
  readonly parked: boolean;
  readonly attempts: number;
}

interface ReplayPage {
  readonly throughId: string | null;
  readonly events: readonly ClaimedEvent[];
}

const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// أحداث الهدف في شركة A: الأنواع الأربعة، منشور وغير منشور وواقف، موزّعة على المدى كله.
const EVENTS_A: readonly TargetEvent[] = [
  { n: 500, type: 'ServiceSessionRecorded', published: true, parked: false, attempts: 0 },
  { n: 2500, type: 'ServiceSessionLinesAdded', published: false, parked: false, attempts: 0 },
  { n: 7500, type: 'ServiceLineChanged', published: true, parked: false, attempts: 4 },
  { n: 12500, type: 'SalaryChanged', published: false, parked: false, attempts: 0 },
  { n: 17500, type: 'ServiceSessionRecorded', published: false, parked: true, attempts: 0 },
];

// نفس الأنواع الأربعة في شركة B، عشان العزل يكون على صفوف موجودة فعلاً مش على شركة فاضية.
const EVENTS_B: readonly TargetEvent[] = [
  { n: 3000, type: 'ServiceSessionRecorded', published: true, parked: false, attempts: 0 },
  { n: 6000, type: 'ServiceSessionLinesAdded', published: false, parked: false, attempts: 0 },
  { n: 9000, type: 'ServiceLineChanged', published: false, parked: false, attempts: 0 },
  { n: 16000, type: 'SalaryChanged', published: true, parked: false, attempts: 0 },
];

// شركة ثالثة بلا أي حدث من الأنواع دي، عشان الحد الأعلى الفارغ يتثبت.
const COMPANY_C = '01920000-0000-7000-8000-0000000000c0';

let testDb: TestDatabase;
let owner: postgres.Sql;
let replayConnection: postgres.Sql;
let dispatcher: OutboxDispatcherDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  replayConnection = postgres(testDb.dispatcherUrl, { max: 1, onnotice: () => undefined });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl, maxConnections: 1 });
  await seedCompany(TENANT.A.company, TENANT.A.business, EVENTS_A);
  await seedCompany(TENANT.B.company, TENANT.B.business, EVENTS_B);
  await owner`INSERT INTO companies (id, name_en, owner_user_id, plan_id)
    VALUES (${COMPANY_C}, 'Company C', ${USER}, ${PROVISIONAL_PLAN_ID})`;
  await owner`ANALYZE outbox`;
  capture.enabled = true;
  try {
    await dispatcher.commissionInputReplayPage(TENANT.A.company, null, null, 2);
    await dispatcher.commissionInputReplayPage(TENANT.A.company, eventId(2500), eventId(17500), 2);
    await dispatcher.commissionInputReplayPage(COMPANY_C, null, null, 2);
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

// كل شركة بتاخد 20000 حدث منشور من نوع غير مستهدف، وبعدين كم صف من الأنواع الأربعة فوق المدى.
async function seedCompany(company: string, business: string, rows: readonly TargetEvent[]) {
  await owner`INSERT INTO outbox(company_id,id,aggregate_type,aggregate_id,event_type,payload,published_at)
    SELECT ${company}, ('01970000-0000-7000-8000-' || lpad(n::text,12,'0'))::uuid,
      'service_session', ${business}, 'BusinessCreated', '{}'::jsonb, clock_timestamp()
    FROM generate_series(1,20000) AS n`;
  for (const row of rows) {
    await owner`UPDATE outbox SET event_type=${row.type}, attempts=${row.attempts},
      published_at=${row.published ? new Date() : null}, parked_at=${row.parked ? new Date() : null}
      WHERE company_id=${company} AND id=${eventId(row.n)}`;
  }
}

// يمشي على صفحات الشركة من أول صفحة، والحد الأعلى ممسوك من نداءها الأول، فصف طالع بعده ما يظهرش.
async function walkFrom(companyId: string, limit: number, first: ReplayPage): Promise<string[]> {
  const ids = first.events.map((event) => event.id);
  let afterId = first.events.at(-1)?.id ?? null;
  for (;;) {
    const page = await dispatcher.commissionInputReplayPage(companyId, afterId, first.throughId, limit);
    if (page.events.length === 0) break;
    ids.push(...page.events.map((event) => event.id));
    afterId = page.events.at(-1)?.id ?? afterId;
  }
  return ids;
}

async function outboxSnapshot(companyId: string) {
  return owner`SELECT id, published_at, attempts, next_attempt_at, parked_at
    FROM outbox WHERE company_id=${companyId} ORDER BY id`;
}

it.each(
  ['high-water mark', 'first page', 'cursor page', 'tenant without commission events'].map(
    (name, position) => ({ name, position }),
  ),
)(
  '$name uses the partial commission replay index with default planner settings',
  async ({ position }) => {
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
    expect(text).not.toMatch(/"Rows Removed by Filter":[1-9]/);
  },
);

it('returns the commission input events of a company with their shape, published and unpublished alike', async () => {
  const page = await dispatcher.commissionInputReplayPage(TENANT.A.company, null, null, 10);
  expect(page.throughId).toBe(eventId(17500));
  expect(page.events.map((event) => event.id)).toEqual(EVENTS_A.map((row) => eventId(row.n)));
  expect(page.events.map((event) => event.eventType)).toEqual([
    'ServiceSessionRecorded',
    'ServiceSessionLinesAdded',
    'ServiceLineChanged',
    'SalaryChanged',
    'ServiceSessionRecorded',
  ]);
  for (const event of page.events) {
    expect(event.companyId).toBe(TENANT.A.company);
    expect(event.aggregateType).toBe('service_session');
    expect(event.aggregateId).toBe(TENANT.A.business);
    expect(event.attempt).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(event.payload)).toBe('{}');
  }
  expect(page.events.find((event) => event.id === eventId(7500))?.attempt).toBe(4);
});

it('walks the company by id with no gap and no duplicate, and never passes the bound it took', async () => {
  const first = await dispatcher.commissionInputReplayPage(TENANT.A.company, null, null, 2);
  expect(first.events.map((event) => event.id)).toEqual([eventId(500), eventId(2500)]);
  // المدى 1..20000 متعبى أصلاً، فالصف اللي فوق الحد الأعلى بيتعمل بتغيير نوعه مش INSERT جديد؛
  // وهو أكبر من الحد الممسوك من أول نداء، فالمفروض ما يظهرش في صفحة تانية.
  try {
    await owner`UPDATE outbox SET event_type='ServiceLineChanged'
      WHERE company_id=${TENANT.A.company} AND id=${eventId(19000)}`;
    const ids = await walkFrom(TENANT.A.company, 2, first);
    expect(ids).toEqual(EVENTS_A.map((row) => eventId(row.n)));
    expect(new Set(ids).size).toBe(ids.length);
  } finally {
    // نرجّع الصف لنوعه عشان الملف ما يعتمدش على ترتيب الاختبارات.
    await owner`UPDATE outbox SET event_type='BusinessCreated'
      WHERE company_id=${TENANT.A.company} AND id=${eventId(19000)}`;
  }
});

it('never returns another company row and answers a company without events with no bound', async () => {
  const a = await dispatcher.commissionInputReplayPage(TENANT.A.company, null, null, 10);
  expect(a.events.every((event) => event.companyId === TENANT.A.company)).toBe(true);
  const b = await dispatcher.commissionInputReplayPage(TENANT.B.company, null, null, 10);
  expect(b.events.map((event) => event.id)).toEqual(EVENTS_B.map((row) => eventId(row.n)));
  expect(b.events.every((event) => event.companyId === TENANT.B.company)).toBe(true);
  expect(await dispatcher.commissionInputReplayPage(COMPANY_C, null, null, 10)).toEqual({
    throughId: null,
    events: [],
  });
});

it('refuses a scope that is not a UUID and a limit outside the batch bound', async () => {
  await expect(
    dispatcher.commissionInputReplayPage('invalid', null, null, 10),
  ).rejects.toThrow('REPLAY_SCOPE_INVALID');
  await expect(
    dispatcher.commissionInputReplayPage(TENANT.A.company, 'invalid', null, 10),
  ).rejects.toThrow('REPLAY_SCOPE_INVALID');
  await expect(
    dispatcher.commissionInputReplayPage(TENANT.A.company, null, 'invalid', 10),
  ).rejects.toThrow('REPLAY_SCOPE_INVALID');
  await expect(
    dispatcher.commissionInputReplayPage(TENANT.A.company, null, null, 0),
  ).rejects.toThrow(/limit must be 1.\d+/);
  await expect(
    dispatcher.commissionInputReplayPage(TENANT.A.company, null, null, 101),
  ).rejects.toThrow(/limit must be 1.\d+/);
});

it('leaves the outbox rows as they were: publication, attempts, backoff and parking do not move', async () => {
  const first = await dispatcher.commissionInputReplayPage(TENANT.A.company, null, null, 2);
  const before = await outboxSnapshot(TENANT.A.company);
  await walkFrom(TENANT.A.company, 2, first);
  expect(await outboxSnapshot(TENANT.A.company)).toEqual(before);
});

it('keeps the session replay page on its own two types and leaves the new ones out', async () => {
  const page = await dispatcher.serviceSessionReplayPage(TENANT.A.company, null, null, 10);
  expect(page.events.map((event) => event.id)).toEqual([eventId(500), eventId(2500), eventId(17500)]);
  const types = page.events.map((event) => event.eventType);
  expect(types).not.toContain('ServiceLineChanged');
  expect(types).not.toContain('SalaryChanged');
});
