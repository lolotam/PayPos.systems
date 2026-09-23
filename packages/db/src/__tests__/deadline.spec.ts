import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { appendAuditLog, createDatabase, type Database } from '../index.ts';

// withTenant's timeoutMs is ONE absolute deadline — pool wait, every statement and the commit. Many short
// statements must not outlive it, and work that missed it must never commit (review of T7b, round 3).
let testDb: TestDatabase;
let pool: Database;
let owner: postgres.Sql;
let sequence = 0;
const nextId = (): string => `019b0000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  pool = createDatabase({ url: testDb.appUrl, ids: { newId: nextId }, maxConnections: 1 });
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await pool.close();
  await owner.end();
  await testDb.drop();
});

const audited = async (id: string): Promise<number> =>
  (await owner`SELECT 1 FROM audit_log WHERE id = ${id}`).length;

describe('the absolute deadline', () => {
  it('ends work made of many short statements, and none of it commits', async () => {
    const id = nextId();
    const started = Date.now();
    await expect(
      pool.withTenant(
        TENANT.A.company,
        async (tx) => {
          await appendAuditLog(tx, id, {
            entity: 'business',
            entityId: TENANT.A.business,
            action: 'probe',
          });
          for (let step = 0; step < 3; step += 1) await tx.execute(sql`SELECT pg_sleep(0.15)`);
        },
        { timeoutMs: 200 },
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - started).toBeLessThan(400);
    await sleep(300);
    expect(await audited(id)).toBe(0);
    // The pool of one is free again: the terminated backend did not keep its connection.
    expect(await pool.withTenant(TENANT.A.company, async () => 'free')).toBe('free');
  });

  it('counts the wait for a connection, and work that missed it never runs', async () => {
    const holder = pool.withTenant(TENANT.A.company, async (tx) => {
      await tx.execute(sql`SELECT pg_sleep(0.5)`);
    });
    const id = nextId();
    let ran = false;
    const started = Date.now();
    await expect(
      pool.withTenant(
        TENANT.A.company,
        async (tx) => {
          ran = true;
          await appendAuditLog(tx, id, {
            entity: 'business',
            entityId: TENANT.A.business,
            action: 'probe',
          });
        },
        { timeoutMs: 150 },
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - started).toBeLessThan(400);
    await holder;
    await sleep(100);
    expect([ran, await audited(id)]).toEqual([false, 0]);
  });
});

describe('work that meets the deadline', () => {
  it('work that finishes in time commits, and its connection is never touched afterwards', async () => {
    const id = nextId();
    await pool.withTenant(
      TENANT.A.company,
      (tx) =>
        appendAuditLog(tx, id, {
          entity: 'business',
          entityId: TENANT.A.business,
          action: 'probe',
        }),
      { timeoutMs: 1_000 },
    );
    // Past the deadline: a stray termination now would hit the next transaction on the same connection.
    await sleep(1_100);
    const after = await pool.withTenant(TENANT.A.company, async (tx) => {
      await tx.execute(sql`SELECT pg_sleep(0.2)`);
      return 'survived';
    });
    expect([await audited(id), after]).toEqual([1, 'survived']);
  });
});
