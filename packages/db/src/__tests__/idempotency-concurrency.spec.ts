import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import {
  IdempotencyKeyBusyError,
  appendOutboxEvent,
  createDatabase,
  runIdempotent,
  type Database,
  type IdempotencyRequest,
  type IdempotentResult,
  type Tx,
} from '../index.ts';

// plan v4 T7 (d)–(f): two requests with one key at the same time. The duplicate waits on the first's
// uncommitted claim, then replays its response, runs as the first if the first rolled back, or gives up
// with a retryable error when the wait passes its lock timeout.
let testDb: TestDatabase;
let database: Database;
let owner: postgres.Sql;
let sequence = 0;
const nextId = (): string => `01950000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  database = createDatabase({ url: testDb.appUrl, ids: { newId: nextId }, maxConnections: 4 });
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await database.close();
  await owner.end();
  await testDb.drop();
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const write = async (tx: Tx, tag: string) => {
  await appendOutboxEvent(tx, nextId(), {
    aggregateType: 'business',
    aggregateId: TENANT.A.business,
    eventType: 'BusinessCreated',
    payload: { tag },
  });
};
const effects = async (tag: string): Promise<number> => {
  const [row] = await owner`SELECT count(*)::int AS n FROM outbox WHERE payload ->> 'tag' = ${tag}`;
  return Number(row?.['n']);
};

// Waits until the second request is blocked on the first's claim, so the test is about the wait.
const untilWaiting = async (): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await owner`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(row?.['n']) > 0) return;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error('the duplicate request never waited on the first claim');
};

// The first request claims, then holds its transaction open until `release`; `fail` makes it roll back.
const holdFirst = (req: IdempotencyRequest, tag: string, fail = false) => {
  const claimed = deferred();
  const release = deferred();
  const result = database.withTenant(TENANT.A.company, (tx) =>
    runIdempotent(tx, req, async () => {
      await write(tx, tag);
      claimed.resolve();
      await release.promise;
      if (fail) throw new Error('first request failed');
      return { status: 201, body: { by: 'first' } };
    }),
  );
  return { claimed: claimed.promise, release: release.resolve, result };
};

const second = (req: IdempotencyRequest, tag: string): Promise<IdempotentResult> =>
  database.withTenant(TENANT.A.company, (tx) =>
    runIdempotent(tx, req, async () => {
      await write(tx, tag);
      return { status: 201, body: { by: 'second' } };
    }),
  );

const req = (key: string, lockTimeoutMs?: number): IdempotencyRequest => ({
  scope: 'COMPANY',
  operation: 'create-business',
  key,
  fingerprint: 'c'.repeat(64),
  ...(lockTimeoutMs === undefined ? {} : { lockTimeoutMs }),
});

describe('concurrent duplicates', () => {
  it('(d) two identical requests produce one effect; the second replays the first response', async () => {
    const first = holdFirst(req('concurrent-d'), 'd');
    await first.claimed;
    const duplicate = second(req('concurrent-d'), 'd');
    await untilWaiting();
    first.release();
    expect(await first.result).toEqual({ status: 201, body: { by: 'first' }, replayed: false });
    expect(await duplicate).toEqual({ status: 201, body: { by: 'first' }, replayed: true });
    expect(await effects('d')).toBe(1);
  });

  it('(e) when the first rolls back, the waiting duplicate executes as the first', async () => {
    const first = holdFirst(req('concurrent-e'), 'e', true);
    await first.claimed;
    const duplicate = second(req('concurrent-e'), 'e');
    await untilWaiting();
    first.release();
    await expect(first.result).rejects.toThrow('first request failed');
    expect(await duplicate).toEqual({ status: 201, body: { by: 'second' }, replayed: false });
    expect(await effects('e')).toBe(1);
  });

  it('(f) a wait past the lock timeout fails with a retryable error and leaves no effect', async () => {
    const first = holdFirst(req('concurrent-f'), 'f');
    await first.claimed;
    await expect(second(req('concurrent-f', 200), 'f-second')).rejects.toThrow(
      IdempotencyKeyBusyError,
    );
    first.release();
    await first.result;
    expect(await effects('f-second')).toBe(0);
  });
});
