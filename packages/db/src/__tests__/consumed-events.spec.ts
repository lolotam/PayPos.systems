import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, markEventConsumed, type Database } from '../index.ts';

// CLAUDE.md §5 / §9: every tenant table has its negative isolation tests. consumed_events holds each
// company's consumer dedupe rows; another company must neither see nor forge them.
let testDb: TestDatabase;
let database: Database;
let owner: postgres.Sql;
const EVENT = '019a0000-0000-7000-8000-000000000001';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  database = createDatabase({ url: testDb.appUrl, ids: { newId: () => EVENT } });
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await database.withTenant(TENANT.A.company, (tx) => markEventConsumed(tx, 'test-a', EVENT));
});

afterAll(async () => {
  await database.close();
  await owner.end();
  await testDb.drop();
});

describe('consumed_events isolation', () => {
  it("company B cannot read company A's dedupe rows", async () => {
    const rows = await database.withTenant(TENANT.B.company, (tx) =>
      tx.execute('SELECT 1 FROM consumed_events'),
    );
    expect(rows).toHaveLength(0);
  });

  it("company B's consumer is not suppressed by company A's row for the same event id", async () => {
    expect(
      await database.withTenant(TENANT.B.company, (tx) => markEventConsumed(tx, 'test-a', EVENT)),
    ).toBe(true);
  });

  it('a row naming another company is rejected by WITH CHECK', async () => {
    await expect(
      database.withTenant(TENANT.A.company, (tx) =>
        tx.execute(`INSERT INTO consumed_events (company_id, consumer_id, event_id)
                    VALUES ('${TENANT.B.company}', 'forged', '${EVENT}')`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('nothing can be recorded without a tenant context', async () => {
    await expect(
      database.withUser('019a0000-0000-7000-8000-0000000000f1', (tx) =>
        markEventConsumed(tx, 'test-a', EVENT),
      ),
    ).rejects.toThrow();
  });

  it('the app cannot change or remove a dedupe row', async () => {
    const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      await expect(app`UPDATE consumed_events SET consumer_id = 'x'`).rejects.toThrow(
        /permission denied/,
      );
      await expect(app`DELETE FROM consumed_events`).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });
});
