import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';
const { A, B } = TENANT;
const id = '01920000-0000-7000-8000-000000000af1';
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => id } });
  for (const tenant of [A, B]) {
    await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date) VALUES (${tenant.company},${id},${tenant.business},${tenant.branch},'Synthetic update','staff','2026-01-01')`;
    await owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES (${tenant.company},${id},${tenant.business},${id},${tenant.branch},'2026-01-01')`;
  }
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));
it('UPDATE sees only the current company and no rows without tenant context', async () => {
  expect(
    await asA(
      sql`UPDATE employees SET name_en='Changed' WHERE company_id=${B.company} RETURNING id`,
    ),
  ).toHaveLength(0);
  expect(
    await asA(
      sql`UPDATE employee_branches SET "to"='2026-10-03' WHERE company_id=${B.company} RETURNING id`,
    ),
  ).toHaveLength(0);
  expect(
    await db.withUser(id, (tx) =>
      tx.execute(sql`UPDATE employees SET name_en='No context' RETURNING id`),
    ),
  ).toHaveLength(0);
  expect(
    await asA(
      sql`UPDATE employees SET name_en='Changed',revision=2 WHERE company_id=${A.company} RETURNING revision`,
    ),
  ).toEqual([{ revision: 2 }]);
  expect(await owner`SELECT name_en,revision FROM employees WHERE company_id=${B.company}`).toEqual(
    [{ name_en: 'Synthetic update', revision: 1 }],
  );
});
it('column grants forbid re-homing, soft deletion, created dates and rewriting branch history starts', async () => {
  for (const change of [
    sql`company_id=${B.company}`,
    sql`business_id=${B.business}`,
    sql`id=${B.branch}`,
    sql`deleted_at=now()`,
    sql`created_at=now()`,
  ])
    await expect(
      asA(sql`UPDATE employees SET ${change} WHERE company_id=${A.company}`),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  for (const change of [
    sql`company_id=${B.company}`,
    sql`branch_id=${B.branch}`,
    sql`employee_id=${B.branch}`,
    sql`"from"='2025-01-01'`,
  ])
    await expect(
      asA(sql`UPDATE employee_branches SET ${change} WHERE company_id=${A.company}`),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  for (const table of ['employees', 'employee_branches'])
    await expect(
      asA(sql`DELETE FROM ${sql.identifier(table)} WHERE company_id=${A.company}`),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
});
it('closing and reattaching preserve old rows, while duplicate active attachments fail', async () => {
  await expect(
    asA(
      sql`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES (${A.company},${A.branch},${A.business},${id},${A.branch},'2026-10-03')`,
    ),
  ).rejects.toThrow();
  await asA(sql`UPDATE employee_branches SET "to"='2026-10-03' WHERE company_id=${A.company}`);
  await asA(
    sql`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES (${A.company},${A.branch},${A.business},${id},${A.branch},'2026-10-04')`,
  );
  expect(
    await owner`SELECT "from"::text,"to"::text FROM employee_branches WHERE company_id=${A.company} ORDER BY "from"`,
  ).toEqual([
    { from: '2026-01-01', to: '2026-10-03' },
    { from: '2026-10-04', to: null },
  ]);
});
it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
  'unrelated runtime %s cannot update employee data or branch history',
  async (url) => {
    const role = postgres(testDb[url], { max: 1, onnotice: () => undefined });
    try {
      await expect(role`UPDATE employees SET name_en='Denied'`).rejects.toThrow(
        /permission denied/,
      );
      await expect(role`UPDATE employee_branches SET "to"='2026-10-03'`).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await role.end();
    }
  },
);
