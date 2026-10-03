import { createDatabase, type Database } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import { employeeWorkplace } from '../employee-workplace.query.ts';

let testDb: TestDatabase, db: Database;
const { A, B } = TENANT;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.branch } });
});
afterAll(async () => {
  await db?.close();
  await testDb?.drop();
});
it('projects business existence and branch identity without crossing tenant', async () => {
  expect(
    await db.withTenant(A.company, (tx) => employeeWorkplace(tx, A.company, A.business, A.branch)),
  ).toEqual({ businessExists: true, branchBusinessId: A.business });
  expect(
    await db.withTenant(A.company, (tx) => employeeWorkplace(tx, A.company, B.business, B.branch)),
  ).toEqual({ businessExists: false, branchBusinessId: null });
});
it('both workplace lookups use tenant-qualified indexes', async () => {
  const plans = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return [
      await tx.execute(
        sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM businesses WHERE company_id=${A.company} AND id=${A.business}`,
      ),
      await tx.execute(
        sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT business_id FROM branches WHERE company_id=${A.company} AND id=${A.branch}`,
      ),
    ];
  });
  expect(JSON.stringify(plans[0])).toContain('businesses_pkey');
  expect(JSON.stringify(plans[1])).toMatch(/branches_(pkey|company_business_id_key)/);
});
