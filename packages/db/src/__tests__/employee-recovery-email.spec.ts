import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

// إيميل الاستعادة عمود اختياري على employees فقط (spec 079 PR-c1): فريد داخل الشركة بين غير المحذوفين،
// وبيتعزل بين الشركات بنفس سياسة جدول الموظفين، وبحث الـ OTP بيمشي على الفهرس الجزئي.
const ids = systemUuidV7();
const { A, B } = TENANT;
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
let counter = 0;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function insert(company: string, business: string, branch: string, email: string | null) {
  const id = ids.newId();
  counter += 1;
  return db.withTenant(company, async (tx) => {
    await tx.execute(sql`INSERT INTO employees
      (company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number,recovery_email)
      VALUES (${company},${id},${business},${branch},'Recovery holder',${employeeNameMatchKey('Recovery holder')},'staff','2999-01-01',${counter},${email})`);
    return id;
  });
}

const constraintOf = (reason: unknown) =>
  (reason as { cause?: { code?: string; constraint_name?: string } }).cause;

it('refuses a duplicate recovery email inside one company, whatever the letter case', async () => {
  await insert(A.company, A.business, A.branch, 'dup@example.test');
  const second = await insert(A.company, A.business, A.branch, 'dup@example.test').catch(
    (error: unknown) => error,
  );
  expect(constraintOf(second)).toMatchObject({
    code: '23505',
    constraint_name: 'employees_company_recovery_email_uidx',
  });
  const upper =
    await owner`SELECT 1 FROM employees WHERE company_id=${A.company} AND lower(recovery_email)='dup@example.test'`;
  expect(upper).toHaveLength(1);
});

it('allows the same address in another company, empty values, and after the holder is soft-deleted', async () => {
  expect(await insert(B.company, B.business, B.branch, 'dup@example.test')).toBeTruthy();
  expect(await insert(A.company, A.business, A.branch, null)).toBeTruthy();
  expect(await insert(A.company, A.business, A.branch, null)).toBeTruthy();
  await owner`UPDATE employees SET deleted_at=now() WHERE company_id=${A.company} AND recovery_email='dup@example.test'`;
  expect(await insert(A.company, A.business, A.branch, 'dup@example.test')).toBeTruthy();
});

it('rejects a malformed or non-canonical address at the database', async () => {
  for (const bad of ['no-at-sign', 'UPPER@example.test', ' pad@example.test', 'a b@example.test']) {
    const refused = await insert(A.company, A.business, A.branch, bad).catch(
      (error: unknown) => error,
    );
    expect(constraintOf(refused)).toMatchObject({
      code: '23514',
      constraint_name: 'employees_recovery_email_format',
    });
  }
});

it('hides the address across tenants and refuses a cross-tenant write', async () => {
  await insert(A.company, A.business, A.branch, 'private-a@example.test');
  const fromB = await db.withTenant(B.company, (tx) =>
    tx.execute(sql`SELECT id FROM employees WHERE recovery_email='private-a@example.test'`),
  );
  expect(Array.from(fromB)).toHaveLength(0);
  const crossUpdate = await db.withTenant(B.company, (tx) =>
    tx.execute(
      sql`UPDATE employees SET recovery_email='stolen@example.test' WHERE company_id=${A.company} RETURNING id`,
    ),
  );
  expect(Array.from(crossUpdate)).toHaveLength(0);
  const crossInsert = await db
    .withTenant(A.company, (tx) =>
      tx.execute(sql`INSERT INTO employees
        (company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number,recovery_email)
        VALUES (${B.company},${ids.newId()},${B.business},${B.branch},'Cross',${employeeNameMatchKey('Cross')},'staff','2999-01-01',999,'x@example.test')`),
    )
    .catch((error: unknown) => error);
  expect(constraintOf(crossInsert)).toMatchObject({ code: '42501' });
});

it('serves the OTP lookup from the partial unique index', async () => {
  const plan = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    return Array.from(
      await tx.execute<{ 'QUERY PLAN': string }>(sql`EXPLAIN (COSTS OFF)
        SELECT id FROM employees
        WHERE company_id=${A.company} AND lower(recovery_email)=lower('private-a@example.test')
          AND recovery_email IS NOT NULL AND deleted_at IS NULL LIMIT 2`),
    )
      .map((row) => row['QUERY PLAN'])
      .join('\n');
  });
  expect(plan).toContain('employees_company_recovery_email_uidx');
});
