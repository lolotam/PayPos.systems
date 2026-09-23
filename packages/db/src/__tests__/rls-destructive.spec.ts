import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

// These statements have no WHERE and no RETURNING on purpose. Either one makes Postgres apply the SELECT
// policy as well, which hides B's rows and would let a broken UPDATE or DELETE policy pass unnoticed.
// They mutate A's fixtures, so they get their own database; results are checked through the owner.
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

const { A, B } = TENANT;

const run = (query: SQL) => db.withTenant(A.company, async (tx) => tx.execute(query));

const refusedByRls = async (query: SQL): Promise<void> => {
  const error = await run(query).then(
    () => null,
    (e: unknown) => e,
  );
  const cause = (error as { cause?: unknown } | null)?.cause;
  expect(cause instanceof Error ? cause.message : String(error)).toMatch(/row-level security/);
};

const everyRow = async () =>
  Array.from(
    await owner`SELECT 'branch' AS kind, company_id FROM branches
                UNION ALL SELECT 'business', company_id FROM businesses ORDER BY 1, 2`,
  );

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  db = createDatabase({
    url: testDb.appUrl,
    ids: { newId: () => '01920000-0000-7000-8000-0000000000c2' },
  });
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await db.close();
  await owner.end();
  await testDb.drop();
});

describe('unconditional UPDATE cannot move rows to another tenant', () => {
  it('UPDATE branches SET company_id = B, business_id = B … is rejected by WITH CHECK', async () => {
    await refusedByRls(
      sql`UPDATE branches SET company_id = ${B.company}, business_id = ${B.business}`,
    );
  });

  it('UPDATE businesses SET company_id = B is rejected by WITH CHECK, not by a foreign key', async () => {
    await refusedByRls(sql`UPDATE businesses SET company_id = ${B.company}`);
  });
});

describe('unconditional DELETE removes only the current tenant’s rows', () => {
  it('DELETE FROM branches, then businesses, as A leaves every row of B', async () => {
    await run(sql`DELETE FROM branches`);
    await run(sql`DELETE FROM businesses`);
    expect(await everyRow()).toEqual([
      { kind: 'branch', company_id: B.company },
      { kind: 'business', company_id: B.company },
    ]);
  });
});
