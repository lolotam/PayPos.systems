import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { PROVISIONAL_PLAN_ID } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  staffAccessFixture,
  type Fixture,
  addEmployee,
  grant,
  nextPhone,
} from '../../../../test/staff-access.fixture.ts';
import { createOnboardingTransactions } from '../persistence/onboarding-transactions.ts';
import { grantStaffMembership } from '../persistence/staff-user-auth.ts';
import { OnboardCompany } from '../use-cases/onboard-company/onboard-company.ts';
import { tenancyCompanyRegistry } from '../persistence/tenancy-company-registry.adapter.ts';
import { staffAccessRecordQuery } from '../persistence/staff-access.ts';
const ids = systemUuidV7();
let f: Fixture;
beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('P1-5 onboarding refuses adding a staff user to any new company', async () => {
  const employee = await addEmployee(f, 'Exclusive staff', f.salmiya, 501);
  expect((await grant(f, employee, nextPhone(f))).status).toBe(200);
  const [record] = await f.h
    .owner`SELECT user_id FROM employee_staff_access WHERE employee_id=${employee}`;
  const onboard = new OnboardCompany(
    createOnboardingTransactions(f.db, ids, f.h.auth.staffUsers.staffCompanyOf),
    tenancyCompanyRegistry,
    ids,
  );
  await expect(
    onboard.execute({
      userId: record?.user_id,
      input: { name_en: 'Forbidden company', plan_id: PROVISIONAL_PLAN_ID },
      idempotency: { key: ids.newId(), fingerprint: 'a'.repeat(64) },
    }),
  ).rejects.toThrow('STAFF_USER_MEMBERSHIP_REFUSED');
  expect(
    await f.h.owner`SELECT id FROM companies WHERE owner_user_id=${record?.user_id}`,
  ).toHaveLength(0);
});
it('P1-5 grant membership verifies company and operation on auth, even with a forged local link row', async () => {
  const employee = await addEmployee(f, 'Binding proof', f.salmiya, 502);
  expect((await grant(f, employee, nextPhone(f))).status).toBe(200);
  const [record] = await f.h
    .owner`SELECT user_id,operation_id FROM employee_staff_access WHERE employee_id=${employee}`;
  const otherCookie = await f.h.signedInOperator('binding-foreign@example.test');
  const otherCompany = await f.h.onboard(otherCookie, 'Binding foreign');
  const otherBusiness = ids.newId();
  const otherBranch = ids.newId();
  await f.h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES (${otherCompany},${otherBusiness},'Binding target','salon')`;
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${otherCompany},${otherBranch},${otherBusiness},'Binding target branch')`;

  for (const companyId of [otherCompany, f.company]) {
    await expect(
      f.db.withTenant(companyId, (tx) =>
        grantStaffMembership(tx, f.h.auth.staffUsers, {
          companyId,
          userId: record?.user_id,
          operationId: companyId === f.company ? ids.newId() : record?.operation_id,
          branchId: companyId === otherCompany ? otherBranch : f.salmiya,
          role: 'staff',
          ids,
        }),
      ),
    ).rejects.toThrow('STAFF_ACCESS_USER_NOT_STAFF');
  }
});
it('P2-1 state query uses its employee index on representative rows and returns the exact shape', async () => {
  const employee = await addEmployee(f, 'Explain target', f.salmiya, 503);
  expect((await grant(f, employee, nextPhone(f))).status).toBe(200);
  const [actor] = await f.h
    .owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${f.company},md5(${f.company}||i::text)::uuid,${f.business},${f.salmiya},'Representative '||i,'representative '||i,'staff','2026-01-01',10000+i
    FROM generate_series(1,1500) i`;
  await f.h
    .owner`INSERT INTO employee_staff_access(company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,phone_hash,attempt_id)
    SELECT ${f.company},md5('access'||${f.company}||i::text)::uuid,${f.business},md5(${f.company}||i::text)::uuid,
      md5('operation'||${f.company}||i::text)::uuid,'staff',${f.salmiya},'PENDING',${actor?.id},repeat('a',64),
      md5('attempt'||${f.company}||i::text)::uuid FROM generate_series(1,1500) i`;
  await f.h.owner.unsafe('ANALYZE employee_staff_access');
  await f.db.withTenant(f.company, async (tx) => {
    const query = staffAccessRecordQuery({ companyId: f.company, employeeId: employee });
    const rows = await tx.execute(query);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'branch_id',
      'operation_id',
      'role_code',
      'state',
      'user_id',
    ]);
    const explained = await tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`);
    expect(JSON.stringify(explained)).toMatch(/Index Scan|Bitmap/);
    expect(JSON.stringify(explained)).toContain('employee_staff_access_employee');
    const plan = explained[0]?.['QUERY PLAN'] as { 'Execution Time': number }[];
    expect(plan[0]?.['Execution Time']).toBeLessThan(200);
  });
});
