import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { appendAuditLog, createDatabase, type Database } from '../index.ts';

// The deadline can fire while COMMIT is in flight (Codex, 2026-10-01): the caller must then get the COMMIT's own
// outcome, never a TimeoutError for work that was saved. A deferred trigger makes this database's COMMIT slow.
let testDb: TestDatabase;
let pool: Database;
let owner: postgres.Sql;
let sequence = 0;
const nextId = (): string => `019b0000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner.unsafe(`
    CREATE FUNCTION slow_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(0.1); RETURN NULL; END $$;
    CREATE CONSTRAINT TRIGGER slow_commit AFTER INSERT ON audit_log
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      WHEN (NEW.action = 'slow_commit') EXECUTE FUNCTION slow_commit();
  `);
  pool = createDatabase({ url: testDb.appUrl, ids: { newId: nextId }, maxConnections: 1 });
});

afterAll(async () => {
  await pool.close();
  await owner.end();
  await testDb.drop();
});

const audited = async (id: string): Promise<number> =>
  (await owner`SELECT 1 FROM audit_log WHERE id = ${id}`).length;

describe('a deadline that fires while COMMIT is in flight', () => {
  it('returns the COMMIT outcome, so a saved write is never reported as timed out', async () => {
    const id = nextId();
    // The work ends at ~150 ms (before the 200 ms deadline); the deferred trigger holds COMMIT until ~250 ms.
    const outcome = await pool
      .withTenant(
        TENANT.A.company,
        async (tx) => {
          await appendAuditLog(tx, id, {
            entity: 'business',
            entityId: TENANT.A.business,
            action: 'slow_commit',
          });
          await tx.execute(sql`SELECT pg_sleep(0.15)`);
          return 'committed';
        },
        { timeoutMs: 200 },
      )
      .catch((error: Error) => error.name);
    expect([outcome, await audited(id)]).toEqual(['committed', 1]);
  });
});
