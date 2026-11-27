import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { expectPgError } from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createDatabase, type Database } from '../index.ts';

// عزل RLS لجدول الفروع الإضافية لدخول الموظفة (080-b): نفس قاعدة جدول السجل الأصلي — RLS إجباري
// ومفروض على pospay_app وحده، والقيد المركّب على السجل الأصلي يمنع صف فروع من غير هوية مطابقة.
const { A, B } = TENANT;
const GRANTEE = '01920000-0000-7000-8000-0000000001f1';
const EMPLOYEE_A = '01920000-0000-7000-8000-0000000001a1';
const EMPLOYEE_A2 = '01920000-0000-7000-8000-0000000001a2';
const ACCESS_A = '01920000-0000-7000-8000-0000000001c1';
const ACCESS_A2 = '01920000-0000-7000-8000-0000000001c2';
const BRANCH_A2 = '01920000-0000-7000-8000-0000000001a3';
const BRANCH_A3 = '01920000-0000-7000-8000-0000000001a4';
const BRANCH_ROW = '01920000-0000-7000-8000-0000000001b1';
const MEMBERSHIP_A = '01920000-0000-7000-8000-0000000001d1';

let testDb: TestDatabase;
let db: Database;

const asTenant = (companyId: string, query: SQL) =>
  db.withTenant(companyId, async (tx) => Array.from(await tx.execute(query)));

const insertBranch = (companyId: string, id: string, branchId: string): SQL => sql`
  INSERT INTO employee_staff_access_branches
    (company_id, id, business_id, employee_id, access_id, branch_id, role_code)
  VALUES (${companyId}, ${id}, ${A.business}, ${EMPLOYEE_A}, ${ACCESS_A}, ${branchId}, 'staff')
  RETURNING id`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await seedTwoTenants(testDb.ownerUrl);
    await owner`INSERT INTO "user" (id, name, email) VALUES (${GRANTEE}, 'Granter', 'granter@example.test')`;
    for (const branchId of [BRANCH_A2, BRANCH_A3]) {
      await owner`INSERT INTO branches (id, company_id, business_id, name_en)
        VALUES (${branchId}, ${A.company}, ${A.business}, 'Extra branch')`;
    }
    for (const [employeeId, accessId] of [
      [EMPLOYEE_A, ACCESS_A],
      [EMPLOYEE_A2, ACCESS_A2],
    ] as const) {
      await owner`INSERT INTO employees
        (company_id, id, business_id, primary_branch_id, name_en, name_en_key, role_code, hire_date, employee_number)
        VALUES (${A.company}, ${employeeId}, ${A.business}, ${A.branch}, ${`Employee ${employeeId}`},
                ${`employee-${employeeId}`}, 'staff', '2026-01-01', ${employeeId === EMPLOYEE_A ? 1 : 2})`;
      await owner`INSERT INTO employee_staff_access
        (company_id, id, business_id, employee_id, operation_id, role_code, branch_id, state, granted_by,
         phone_hash, attempt_id)
        VALUES (${A.company}, ${accessId}, ${A.business}, ${employeeId}, ${accessId}, 'staff', ${A.branch},
                'PENDING', ${GRANTEE}, 'hash', ${accessId})`;
    }
    const [role] = await owner<{ id: string }[]>`
      SELECT id FROM roles WHERE code = 'staff' AND company_id IS NULL`;
    if (role === undefined) throw new Error('missing staff role');
    await owner`INSERT INTO memberships
      (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
      VALUES (${A.company}, ${MEMBERSHIP_A}, ${GRANTEE}, ${role.id}::uuid, 'global', 'BRANCH', ${A.branch})`;
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => BRANCH_ROW } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

it('the extra-branch table carries forced row-level security and the four tenant policies', async () => {
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    const tables = await owner<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'employee_staff_access_branches'`;
    expect(tables).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await owner<{ cmd: string }[]>`
      SELECT cmd FROM pg_policies WHERE tablename = 'employee_staff_access_branches' ORDER BY cmd`;
    expect(policies.map((row) => row.cmd)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
  } finally {
    await owner.end();
  }
});

it('pospay_app holds exactly the four table grants and no other role holds any', async () => {
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    const grants = await owner<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'employee_staff_access_branches' AND grantee = 'pospay_app'
      ORDER BY privilege_type`;
    expect(grants.map((row) => row.privilege_type)).toEqual([
      'DELETE',
      'INSERT',
      'SELECT',
      'UPDATE',
    ]);
    const others = await owner<{ role: string }[]>`
      SELECT r AS role FROM unnest(${['pospay_auth', 'pospay_dispatcher', 'pospay_notifications']}::text[]) AS r
      WHERE has_table_privilege(r, 'employee_staff_access_branches', 'SELECT, INSERT, UPDATE, DELETE')`;
    expect(others).toEqual([]);
    const publicGrants = await owner<{ grantee: string }[]>`
      SELECT grantee FROM information_schema.role_table_grants
      WHERE table_name = 'employee_staff_access_branches' AND grantee = 'PUBLIC'`;
    expect(publicGrants).toEqual([]);
  } finally {
    await owner.end();
  }
});

it('company B reads none of the extra-branch rows of company A and cannot write one for A', async () => {
  const inserted = await asTenant(A.company, insertBranch(A.company, BRANCH_ROW, A.branch));
  expect(inserted).toHaveLength(1);
  expect(await asTenant(A.company, sql`SELECT id FROM employee_staff_access_branches`)).toEqual([
    { id: BRANCH_ROW },
  ]);
  expect(await asTenant(B.company, sql`SELECT id FROM employee_staff_access_branches`)).toEqual([]);
  // صف على شركة A من جلسة B: سياسة الإدراج بترفض قبل أي مفتاح أجنبي.
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      tx.execute(insertBranch(A.company, '01920000-0000-7000-8000-0000000001b2', A.branch)),
    ),
    '42501',
  );
  // تعديل صف A من جلسة B بلا أثر (الصف غير مرئي)، والحذف بيمسح صفر صفوف لنفس السبب.
  const crossUpdate = await db.withTenant(B.company, (tx) =>
    tx.execute(
      sql`UPDATE employee_staff_access_branches SET role_code = 'reception' WHERE id = ${BRANCH_ROW}`,
    ),
  );
  expect(crossUpdate).toHaveLength(0);
  const crossDelete = await db.withTenant(B.company, (tx) =>
    tx.execute(sql`DELETE FROM employee_staff_access_branches WHERE id = ${BRANCH_ROW}`),
  );
  expect(crossDelete).toHaveLength(0);
  // نقل الصف لشركة تانية من داخل جلسة A: شرط WITH CHECK بيرفض نقله خارج الشركة.
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      tx.execute(
        sql`UPDATE employee_staff_access_branches SET company_id = ${B.company} WHERE id = ${BRANCH_ROW}`,
      ),
    ),
    '42501',
  );
  expect(
    await asTenant(
      A.company,
      sql`SELECT role_code FROM employee_staff_access_branches WHERE id = ${BRANCH_ROW}`,
    ),
  ).toEqual([{ role_code: 'staff' }]);
});

it('a session with no tenant set reads zero rows and cannot insert', async () => {
  const bare = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await bare`SELECT id FROM employee_staff_access_branches`).toEqual([]);
    await expectPgError(
      bare`
        INSERT INTO employee_staff_access_branches
          (company_id, id, business_id, employee_id, access_id, branch_id, role_code)
        VALUES (${A.company}, ${'01920000-0000-7000-8000-0000000001b3'}, ${A.business}, ${EMPLOYEE_A},
                ${ACCESS_A}, ${A.branch}, 'staff')`,
      '42501',
    );
  } finally {
    await bare.end();
  }
});

it('the parent composite foreign key refuses a row whose employee differs from the access record', async () => {
  await expectPgError(
    asTenant(A.company, sql`
      INSERT INTO employee_staff_access_branches
        (company_id, id, business_id, employee_id, access_id, branch_id, role_code)
      VALUES (${A.company}, ${'01920000-0000-7000-8000-0000000001b4'}, ${A.business}, ${EMPLOYEE_A2},
              ${ACCESS_A}, ${BRANCH_A2}, 'staff')`),
    '23503',
    'employee_staff_access_branches_access_fk',
  );
});

it('one membership serves one extra branch only, and rows without a membership stay unlimited', async () => {
  const first = await asTenant(A.company, sql`
    INSERT INTO employee_staff_access_branches
      (company_id, id, business_id, employee_id, access_id, branch_id, role_code, membership_id)
    VALUES (${A.company}, ${'01920000-0000-7000-8000-0000000001b5'}, ${A.business}, ${EMPLOYEE_A},
            ${ACCESS_A}, ${BRANCH_A2}, 'staff', ${MEMBERSHIP_A})
    RETURNING id`);
  expect(first).toHaveLength(1);
  await expectPgError(
    asTenant(A.company, sql`
      INSERT INTO employee_staff_access_branches
        (company_id, id, business_id, employee_id, access_id, branch_id, role_code, membership_id)
      VALUES (${A.company}, ${'01920000-0000-7000-8000-0000000001b6'}, ${A.business}, ${EMPLOYEE_A},
              ${ACCESS_A}, ${BRANCH_A3}, 'staff', ${MEMBERSHIP_A})`),
    '23505',
    'employee_staff_access_branches_membership_uidx',
  );
  for (const [index, branchId] of [BRANCH_A2, BRANCH_A3].entries()) {
    const withoutMembership = await asTenant(A.company, sql`
      INSERT INTO employee_staff_access_branches
        (company_id, id, business_id, employee_id, access_id, branch_id, role_code)
      VALUES (${A.company}, ${`01920000-0000-7000-8000-0000000001c${index}`}, ${A.business}, ${EMPLOYEE_A2},
              ${ACCESS_A2}, ${branchId}, 'reception')
      RETURNING id`);
    expect(withoutMembership).toHaveLength(1);
  }
});
