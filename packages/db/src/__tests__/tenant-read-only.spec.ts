import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  seedCommissionStatementTenants,
  expectPgError,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let db: Database;
const { A } = COMMISSION_TENANT;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => crypto.randomUUID() } });
});

afterAll(async () => {
  await db?.close();
  await testDb?.drop();
});

it('refuses a write inside a read-only tenant transaction', async () => {
  await expectPgError(
    db.withTenant(
      A.company,
      async (tx) => {
        await tx.execute(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status)
          VALUES (app_company_id(),gen_random_uuid(),${A.business}::uuid,'2019-01','DRAFT')`);
      },
      { readOnly: true },
    ),
    '25006',
  );
});

it('reads inside a read-only tenant transaction and leaves the rows untouched', async () => {
  const before = await db.withTenant(A.company, (tx) =>
    tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM commission_statements`,
    ),
  );
  const rows = await db.withTenant(
    A.company,
    async (tx) =>
      tx.execute<{ count: number }>(
        sql`SELECT count(*)::int AS count FROM commission_statements`,
      ),
    { readOnly: true },
  );
  const after = await db.withTenant(A.company, (tx) =>
    tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM commission_statements`,
    ),
  );

  expect(rows).toEqual(before);
  expect(after).toEqual(before);
});

it('keeps the default tenant transaction writable', async () => {
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`INSERT INTO commission_statements(company_id,id,business_id,period,status)
      VALUES (app_company_id(),gen_random_uuid(),${A.business}::uuid,'2019-02','DRAFT')`);
  });
  const [row] = await db.withTenant(A.company, (tx) =>
    tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM commission_statements WHERE period='2019-02'`,
    ),
  );
  expect(row?.count).toBe(1);
});
