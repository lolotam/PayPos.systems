import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const ids = systemUuidV7();
const { A, B } = TENANT;
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
const userId = ids.newId();
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO "user"(id,name,email) VALUES (${userId},'Synthetic employee','employee-unique@example.test')`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function insert(company: string, business: string, branch: string, user: string | null = userId) {
  const id = ids.newId();
  return db.withTenant(company, (tx) =>
    tx.execute(sql`INSERT INTO employees
    (company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date)
    VALUES (${company},${id},${business},${branch},${user},'Duplicate name',${employeeNameMatchKey('Duplicate name')},'staff','2999-01-01') RETURNING id`),
  );
}
it('enforces same-business uniqueness under concurrent direct tenant writes', async () => {
  const results = await Promise.allSettled([
    insert(A.company, A.business, A.branch),
    insert(A.company, A.business, A.branch),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const refused = results.find((r) => r.status === 'rejected');
  const cause =
    refused?.status === 'rejected' ? (refused.reason as { cause: unknown }).cause : null;
  expect(cause).toMatchObject({
    code: '23505',
    constraint_name: 'employees_active_user_business_key',
  });
  expect(
    await owner`SELECT id FROM employees WHERE company_id=${A.company} AND business_id=${A.business} AND user_id=${userId}`,
  ).toHaveLength(1);
});
it('permits the same user in different businesses and companies', async () => {
  const business = ids.newId(),
    branch = ids.newId();
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES (${A.company},${business},'Second business','salon')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES (${A.company},${branch},${business},'Second branch')`;
  expect(await insert(A.company, business, branch)).toHaveLength(1);
  expect(await insert(B.company, B.business, B.branch)).toHaveLength(1);
});
it('does not reserve null user links or soft-deleted predecessors', async () => {
  expect(await insert(A.company, A.business, A.branch, null)).toHaveLength(1);
  expect(await insert(A.company, A.business, A.branch, null)).toHaveLength(1);
  await owner`UPDATE employees SET deleted_at=now() WHERE company_id=${A.company} AND business_id=${A.business} AND user_id=${userId}`;
  expect(await insert(A.company, A.business, A.branch)).toHaveLength(1);
  const [index] =
    await owner`SELECT indisunique,pg_get_expr(indpred,indrelid) AS predicate FROM pg_index WHERE indexrelid='employees_active_user_business_key'::regclass`;
  expect(index).toMatchObject({ indisunique: true });
  expect(index?.['predicate']).toContain('deleted_at IS NULL');
  expect(index?.['predicate']).toContain('user_id IS NOT NULL');
});
