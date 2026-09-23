import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, USER, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import {
  IdempotencyKeyReusedError,
  appendOutboxEvent,
  createDatabase,
  runIdempotent,
  type Database,
  type IdempotencyRequest,
  type Tx,
} from '../index.ts';

// plan v4 T7 "Done when" (b)–(f), plus scope isolation and the no-IN_FLIGHT guarantee.
let testDb: TestDatabase;
let database: Database;
let owner: postgres.Sql;
let sequence = 0;
const nextId = (): string => `01940000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;
let keySequence = 0;
const request = (overrides: Partial<IdempotencyRequest> = {}): IdempotencyRequest => ({
  scope: 'COMPANY',
  operation: 'create-business',
  key: `key-${++keySequence}`,
  fingerprint: 'a'.repeat(64),
  ...overrides,
});

// The effect every test runs: one outbox row, tagged so the test can count its own effects.
const effect = (tag: string, body: unknown) => async (tx: Tx) => {
  await appendOutboxEvent(tx, nextId(), {
    aggregateType: 'business',
    aggregateId: TENANT.A.business,
    eventType: 'BusinessCreated',
    payload: { tag },
  });
  return { status: 201, body };
};
const effects = async (tag: string): Promise<number> => {
  const [row] = await owner`SELECT count(*)::int AS n FROM outbox WHERE payload ->> 'tag' = ${tag}`;
  return Number(row?.['n']);
};

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

const inA = <T>(fn: (tx: Tx) => Promise<T>) => database.withTenant(TENANT.A.company, fn);

describe('sequential requests', () => {
  it('(b) a replayed key returns the identical stored response and runs no second effect', async () => {
    const req = request();
    const first = await inA((tx) => runIdempotent(tx, req, () => effect('b', { id: 1 })(tx)));
    const again = await inA((tx) => runIdempotent(tx, req, () => effect('b', { id: 2 })(tx)));
    expect(first).toEqual({ status: 201, body: { id: 1 }, replayed: false });
    expect(again).toEqual({ status: 201, body: { id: 1 }, replayed: true });
    expect(await effects('b')).toBe(1);
  });

  it('(c) the same key with a different request is rejected, never replayed', async () => {
    const req = request();
    await inA((tx) => runIdempotent(tx, req, () => effect('c', { id: 1 })(tx)));
    await expect(
      inA((tx) =>
        runIdempotent(tx, { ...req, fingerprint: 'b'.repeat(64) }, () => effect('c', {})(tx)),
      ),
    ).rejects.toThrow(IdempotencyKeyReusedError);
    expect(await effects('c')).toBe(1);
  });

  it('a failed effect rolls the claim back, so the same key can run again', async () => {
    const req = request();
    await expect(
      inA((tx) =>
        runIdempotent(tx, req, async () => {
          await effect('retry', {})(tx);
          throw new Error('effect failed');
        }),
      ),
    ).rejects.toThrow('effect failed');
    const retried = await inA((tx) => runIdempotent(tx, req, () => effect('retry', { ok: 1 })(tx)));
    expect(retried).toEqual({ status: 201, body: { ok: 1 }, replayed: false });
    expect(await effects('retry')).toBe(1);
  });

  it('a claim can never commit without its response — there is no persisted IN_FLIGHT row', async () => {
    const req = request();
    await expect(
      inA((tx) =>
        tx.execute(`
          INSERT INTO idempotency_keys (scope_type, scope_id, company_id, operation, key, request_fingerprint, expires_at)
          VALUES ('COMPANY', app_company_id(), app_company_id(), 'create-business', '${req.key}', '${req.fingerprint}', now() + interval '1 day')`),
      ),
    ).rejects.toMatchObject({ constraint_name: 'idempotency_keys_require_response' });
    expect(await owner`SELECT 1 FROM idempotency_keys WHERE key = ${req.key}`).toHaveLength(0);
  });
});

describe('scopes', () => {
  it('the same key in another company is a different key, and its row is invisible', async () => {
    const req = request();
    await inA((tx) => runIdempotent(tx, req, () => effect('scope', { company: 'A' })(tx)));
    const inB = await database.withTenant(TENANT.B.company, (tx) =>
      runIdempotent(tx, req, async () => ({ status: 201, body: { company: 'B' } })),
    );
    expect(inB).toEqual({ status: 201, body: { company: 'B' }, replayed: false });
    const visible = await database.withTenant(TENANT.B.company, (tx) =>
      tx.execute(`SELECT scope_id FROM idempotency_keys WHERE key = '${req.key}'`),
    );
    expect(Array.from(visible)).toEqual([{ scope_id: TENANT.B.company }]);
  });

  it('a USER-scoped key works before a tenant exists and replays for the same user', async () => {
    const req = request({ scope: 'USER', operation: 'onboard-company' });
    const run = () =>
      database.withUser(USER, (tx) =>
        runIdempotent(tx, req, async () => ({ status: 201, body: { n: 1 } })),
      );
    expect(await run()).toMatchObject({ replayed: false });
    expect(await run()).toEqual({ status: 201, body: { n: 1 }, replayed: true });
  });

  it('rejects a key outside visible ASCII before touching the database', async () => {
    await expect(
      inA((tx) =>
        runIdempotent(tx, request({ key: 'has space' }), async () => ({ status: 200, body: null })),
      ),
    ).rejects.toThrow(TypeError);
  });
});
