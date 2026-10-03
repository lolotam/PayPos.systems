import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, SYSTEM_ROLES, type Database } from '../index.ts';

const { A, B } = TENANT;
const ID = '01920000-0000-7000-8000-000000000abc';
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => ID } });
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
    VALUES (${B.company},${ID},${B.business},${B.branch},'Sentinel B','staff','2026-01-01')`;
  await owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES (${B.company},${ID},${B.business},${ID},${B.branch},'2026-01-01')`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));
const employeeInsert = (
  company: string,
  business: string,
  branch: string,
) => sql`INSERT INTO employees
  (company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
  VALUES (${company},${ID},${business},${branch},'Synthetic','staff','2026-01-01') RETURNING id`;
const attachmentInsert = (
  company: string,
  business: string,
  branch: string,
) => sql`INSERT INTO employee_branches
  (company_id,id,business_id,employee_id,branch_id,"from") VALUES (${company},${ID},${business},${ID},${branch},'2026-01-01') RETURNING id`;

it.each(['employees', 'employee_branches'])(
  '%s is FORCE RLS and invisible without tenant context',
  async (table) => {
    const [flags] =
      await owner`SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname=${table}`;
    expect(flags).toMatchObject({
      relrowsecurity: true,
      relforcerowsecurity: true,
      owner: 'pospay_owner',
    });
    expect(await asA(sql`SELECT id FROM ${sql.identifier(table)}`)).toHaveLength(0);
    expect(
      await db.withUser(A.business, (tx) =>
        tx.execute(sql`SELECT id FROM ${sql.identifier(table)}`),
      ),
    ).toHaveLength(0);
  },
);
it('cross-tenant inserts and foreign tenant/business parents are refused', async () => {
  await expect(asA(employeeInsert(B.company, B.business, B.branch))).rejects.toThrow();
  await expect(asA(attachmentInsert(B.company, B.business, B.branch))).rejects.toThrow();
  await expect(asA(employeeInsert(A.company, B.business, B.branch))).rejects.toThrow();
  await expect(asA(employeeInsert(A.company, A.business, B.branch))).rejects.toThrow();
  await expect(asA(attachmentInsert(A.company, A.business, A.branch))).rejects.toThrow();
});
it('identical IDs in separate tenants remain valid; each attachment has its own tenant parent', async () => {
  expect(await asA(employeeInsert(A.company, A.business, A.branch))).toHaveLength(1);
  expect(await asA(attachmentInsert(A.company, A.business, A.branch))).toHaveLength(1);
  expect(await owner`SELECT id FROM employees WHERE id=${ID}`).toHaveLength(2);
});
it('same-tenant business cannot reference a branch or employee from another business', async () => {
  const other = '01920000-0000-7000-8000-000000000acd';
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES (${A.company},${other},'Other business','salon')`;
  await expect(asA(employeeInsert(A.company, other, A.branch))).rejects.toThrow();
  await expect(asA(attachmentInsert(A.company, other, A.branch))).rejects.toThrow();
});
it.each(['employees', 'employee_branches'])(
  '%s has no runtime delete or immutable tenant-key update permission',
  async (table) => {
    await expect(
      asA(sql`UPDATE ${sql.identifier(table)} SET company_id=${B.company} WHERE id=${ID}`),
    ).rejects.toThrow();
    await expect(
      asA(sql`DELETE FROM ${sql.identifier(table)} WHERE company_id=${B.company}`),
    ).rejects.toThrow();
    await expect(
      asA(
        sql`INSERT INTO ${sql.identifier(table)} SELECT * FROM ${sql.identifier(table)} ON CONFLICT (company_id,id) DO UPDATE SET company_id=${B.company}`,
      ),
    ).rejects.toThrow();
  },
);
it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
  '%s cannot read or mutate either tenant table',
  async (url) => {
    const role = postgres(testDb[url], { max: 1, onnotice: () => undefined });
    try {
      for (const table of ['employees', 'employee_branches']) {
        await expect(role`SELECT id FROM ${role(table)}`).rejects.toThrow(/permission denied/);
        await expect(role`DELETE FROM ${role(table)}`).rejects.toThrow(/permission denied/);
      }
    } finally {
      await role.end();
    }
  },
);
it('membership and PIN employee references are tenant qualified even though legacy validation is deferred', async () => {
  const staffRole = SYSTEM_ROLES.find((r) => r.code === 'staff')?.id as string;
  const foreignEmployee = '01920000-0000-7000-8000-000000000abe';
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
      VALUES (${B.company},${foreignEmployee},${B.business},${B.branch},'Foreign employee','staff','2026-01-01')`;
  await expect(
    asA(sql`INSERT INTO memberships(company_id,id,employee_id,role_id,role_owner_key,scope_type,scope_id)
      VALUES (${A.company},${foreignEmployee},${foreignEmployee},${staffRole},'global','BUSINESS',${A.business})`),
  ).rejects.toThrow();
  await expect(
    asA(sql`INSERT INTO cashier_pins(company_id,id,employee_id,pin_hash,set_at)
      VALUES (${A.company},${foreignEmployee},${foreignEmployee},'pbkdf2-sha256$synthetic',now())`),
  ).rejects.toThrow();
});
