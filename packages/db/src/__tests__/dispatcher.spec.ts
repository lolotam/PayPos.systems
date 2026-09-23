import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import {
  appendAuditLog,
  appendOutboxEvent,
  createDatabase,
  createOutboxDispatcherDatabase,
  markEventConsumed,
  type ClaimedEvent,
  type Database,
  type DeliveryOutcome,
  type OutboxDispatcherDatabase,
} from '../index.ts';

// plan v4 T7b "Done when": delivery of committed events only, retries, parking, per-aggregate ordering,
// concurrent dispatchers, a crash between publish and mark, and fan-out — each effect applied exactly once.
let testDb: TestDatabase;
let app: Database;
let dispatcher: OutboxDispatcherDatabase;
let owner: postgres.Sql;
let sequence = 0;
const nextId = (): string => `01970000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  app = createDatabase({ url: testDb.appUrl, ids: { newId: nextId }, maxConnections: 6 });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl, maxConnections: 3 });
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await dispatcher.close();
  await app.close();
  await owner.end();
  await testDb.drop();
});

const publish = async (company: string, aggregateId: string, fail = false): Promise<string> => {
  const id = nextId();
  await app
    .withTenant(company, async (tx) => {
      await appendOutboxEvent(tx, id, {
        aggregateType: 'business',
        aggregateId,
        eventType: 'BusinessCreated',
        payload: { n: sequence },
      });
      if (fail) throw new Error('rolled back');
    })
    .catch(() => undefined);
  return id;
};

// A consumer: records its dedupe row and its effect (an audit row) in one tenant transaction.
const consume = (consumerId: string) => async (event: ClaimedEvent) => {
  await app.withTenant(event.companyId, async (tx) => {
    if (await markEventConsumed(tx, consumerId, event.id)) {
      await appendAuditLog(tx, nextId(), {
        entity: 'business',
        entityId: event.aggregateId,
        action: `consumed.${consumerId.replaceAll('-', '_')}`,
        after: { event: event.id },
      });
    }
  });
};
const effects = async (eventId: string, consumerId = 'test-a'): Promise<number> => {
  const [row] = await owner`
    SELECT count(*)::int AS n FROM audit_log
    WHERE after ->> 'event' = ${eventId} AND action = ${`consumed.${consumerId.replaceAll('-', '_')}`}`;
  return Number(row?.['n']);
};
const delivered =
  (consumers: string[] = ['test-a']) =>
  async (event: ClaimedEvent): Promise<DeliveryOutcome> => {
    for (const consumer of consumers) await consume(consumer)(event);
    return { delivered: true };
  };
const drain = async (deliver = delivered()): Promise<void> => {
  while ((await dispatcher.dispatchBatch(50, deliver)) > 0);
};
const state = async (id: string) => {
  const [row] = await owner`
    SELECT published_at IS NOT NULL AS published, parked_at IS NOT NULL AS parked, attempts, last_error
    FROM outbox WHERE id = ${id}`;
  return row;
};

describe('delivery', () => {
  it('delivers a committed event once; a rolled-back one never exists to deliver', async () => {
    const committed = await publish(TENANT.A.company, nextId());
    const rolledBack = await publish(TENANT.A.company, nextId(), true);
    await drain();
    expect(await state(committed)).toMatchObject({ published: true, attempts: 1 });
    expect(await effects(committed)).toBe(1);
    expect(await owner`SELECT 1 FROM outbox WHERE id = ${rolledBack}`).toHaveLength(0);
  });

  it('delivers across tenants, each effect inside its own company', async () => {
    const [a, b] = [
      await publish(TENANT.A.company, nextId()),
      await publish(TENANT.B.company, nextId()),
    ];
    await drain();
    const rows =
      await owner`SELECT company_id FROM audit_log WHERE after ->> 'event' IN (${a}, ${b}) ORDER BY 1`;
    expect(rows.map((r) => r['company_id'])).toEqual([TENANT.A.company, TENANT.B.company].sort());
  });

  it('fans out: each of two consumers applies the event exactly once', async () => {
    const id = await publish(TENANT.A.company, nextId());
    await drain(delivered(['test-a', 'test-b']));
    await consume('test-a')({ ...(await claimedShape(id)) });
    expect([await effects(id, 'test-a'), await effects(id, 'test-b')]).toEqual([1, 1]);
  });
});

const claimedShape = async (id: string): Promise<ClaimedEvent> => {
  const [row] = await owner`SELECT company_id, aggregate_id FROM outbox WHERE id = ${id}`;
  return {
    companyId: String(row?.['company_id']),
    id,
    aggregateType: 'business',
    aggregateId: String(row?.['aggregate_id']),
    eventType: 'BusinessCreated',
    payload: {},
    attempts: 0,
  };
};

describe('failures', () => {
  it('retries after a failed delivery, then records success', async () => {
    const id = await publish(TENANT.A.company, nextId());
    let calls = 0;
    await drain(async (event) => {
      calls += 1;
      if (calls === 1) return { delivered: false, error: 'TypeError', retryInMs: 0 };
      return delivered()(event);
    });
    expect(await state(id)).toMatchObject({ published: true, attempts: 2, last_error: null });
    expect(await effects(id)).toBe(1);
  });

  it('parks an event whose last attempt failed, and holds later events of the same aggregate', async () => {
    const aggregate = nextId();
    const poison = await publish(TENANT.A.company, aggregate);
    const behind = await publish(TENANT.A.company, aggregate);
    const other = await publish(TENANT.A.company, nextId());
    await drain(async (event) =>
      event.id === poison
        ? { delivered: false, error: 'Error', retryInMs: null }
        : delivered()(event),
    );
    expect(await state(poison)).toMatchObject({
      published: false,
      parked: true,
      last_error: 'Error',
    });
    expect(await state(behind)).toMatchObject({ published: false, attempts: 0 });
    expect(await state(other)).toMatchObject({ published: true });
  });
});

describe('ordering, crashes and concurrency', () => {
  it('holds the next event of an aggregate until the one before it is published', async () => {
    const aggregate = nextId();
    const first = await publish(TENANT.A.company, aggregate);
    const second = await publish(TENANT.A.company, aggregate);
    await dispatcher.dispatchBatch(50, delivered());
    expect(await state(first)).toMatchObject({ published: true });
    expect(await state(second)).toMatchObject({ published: false, attempts: 0 });
    await dispatcher.dispatchBatch(50, delivered());
    expect(await state(second)).toMatchObject({ published: true });
  });

  it('a crash after the effect and before the mark redelivers, and the effect stays single', async () => {
    const id = await publish(TENANT.A.company, nextId());
    await expect(
      dispatcher.dispatchBatch(50, async (event) => {
        await consume('test-a')(event);
        throw new Error('dispatcher crashed before recording the delivery');
      }),
    ).rejects.toThrow('crashed');
    expect(await state(id)).toMatchObject({ published: false, attempts: 0 });
    await drain();
    expect(await state(id)).toMatchObject({ published: true });
    expect(await effects(id)).toBe(1);
  });

  it('two dispatchers at once never deliver one event twice', async () => {
    const ids = await Promise.all(
      Array.from({ length: 6 }, () => publish(TENANT.A.company, nextId())),
    );
    const counts = new Map<string, number>();
    const slow = async (event: ClaimedEvent) => {
      counts.set(event.id, (counts.get(event.id) ?? 0) + 1);
      await new Promise((done) => setTimeout(done, 50));
      return delivered()(event);
    };
    await Promise.all([drain(slow), drain(slow)]);
    for (const id of ids) {
      expect(counts.get(id)).toBe(1);
      expect(await effects(id)).toBe(1);
    }
  });
});
