import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { appendAuditLog, createDatabase, type Database, type Tx } from '../index.ts';
import { createTenantWrappers } from '../with-tenant.ts';

// The deadline at the COMMIT boundary (Codex, 2026-10-01). A COMMIT sent in time answers for itself; late work never
// commits even when a blocked event loop delays the timer; and a COMMIT whose reply never comes ends as "outcome
// unknown", not as a wait forever. A deferred trigger makes this database's COMMIT slow.
let testDb: TestDatabase;
let pool: Database;
let owner: postgres.Sql;
let sequence = 0;
const nextId = (): string => `019b0000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner.unsafe(`
    CREATE FUNCTION slow_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(2.25); RETURN NULL; END $$;
    CREATE CONSTRAINT TRIGGER slow_commit AFTER INSERT ON audit_log
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      WHEN (NEW.action = 'slow_commit') EXECUTE FUNCTION slow_commit();
  `);
  pool = createDatabase({ url: testDb.appUrl, ids: { newId: nextId }, maxConnections: 1 });
  // Open the pool's one connection now, so connecting is not counted inside a test's deadline.
  await pool.withTenant(TENANT.A.company, async () => undefined);
});

afterAll(async () => {
  await pool.close();
  await owner.end();
  await testDb.drop();
});

const audited = async (id: string): Promise<number> =>
  (await owner`SELECT 1 FROM audit_log WHERE id = ${id}`).length;

const audit = (tx: Tx, id: string, action: string) =>
  appendAuditLog(tx, id, { entity: 'business', entityId: TENANT.A.business, action });

describe('a deadline that fires while COMMIT is in flight', () => {
  it('returns the COMMIT outcome, so a saved write is never reported as timed out', async () => {
    const id = nextId();
    const started = performance.now();
    // Proportional margins, because timing on a dev machine is noisy: work ends at ~1.5 s of a 3 s deadline, and
    // the deferred trigger holds COMMIT for 2.25 s (0.75 s under the 3 s statement_timeout), so COMMIT ends at
    // ~3.75 s — after the deadline, and well before the watchdog at 6 s.
    const outcome = await pool
      .withTenant(
        TENANT.A.company,
        async (tx) => {
          await audit(tx, id, 'slow_commit');
          await tx.execute(sql`SELECT pg_sleep(1.5)`);
          return 'committed';
        },
        { timeoutMs: 3_000 },
      )
      .catch((error: Error) => error.name);
    expect([outcome, await audited(id)]).toEqual(['committed', 1]);
    expect(performance.now() - started).toBeGreaterThan(3_000);
  }, 15_000);
});

describe('work that finishes late', () => {
  it('never commits, even when a blocked event loop delays the timer past the deadline', async () => {
    const id = nextId();
    const outcome = await pool
      .withTenant(
        TENANT.A.company,
        async (tx) => {
          await audit(tx, id, 'probe');
          await tx.execute(sql`SELECT pg_sleep(0.15)`);
          // Synchronous work past the 300 ms deadline: the timer cannot fire until it ends.
          const until = performance.now() + 250;
          let spins = 0;
          while (performance.now() < until) spins += 1;
          return spins;
        },
        { timeoutMs: 300 },
      )
      .then(
        () => 'committed',
        (error: Error) => error.name,
      );
    await sleep(200);
    expect([outcome, await audited(id)]).toEqual(['TimeoutError', 0]);
  });
});

describe('a COMMIT whose reply never comes', () => {
  it('ends as CommitOutcomeUnknownError after the deadline and as long again', async () => {
    // A client whose transaction runs the work and then never hears back from COMMIT.
    const hangingCommit = {
      transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        await work({ execute: async () => [{ privileged: false }] });
        return new Promise(() => undefined);
      },
    } as unknown as PostgresJsDatabase;
    const wrappers = createTenantWrappers(hangingCommit, { newId: nextId });
    const started = performance.now();
    await expect(
      wrappers.withTenant(TENANT.A.company, async () => 'done', { timeoutMs: 50 }),
    ).rejects.toMatchObject({ name: 'CommitOutcomeUnknownError' });
    expect(performance.now() - started).toBeGreaterThanOrEqual(95);
  });
});
