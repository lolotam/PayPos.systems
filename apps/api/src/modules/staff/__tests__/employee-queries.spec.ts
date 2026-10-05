import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeContext } from '../persistence/employee-context.adapter.ts';
import {
  employeesFixture,
  grantEmployeeCreation,
  detailFor,
  termsFor,
  type EmployeeFixture,
} from './employees.fixture.ts';

let f: EmployeeFixture;
beforeAll(async () => {
  f = await employeesFixture();
  await grantEmployeeCreation(f);
});
it('workplace context contains only scope data and active link lookup uses the partial unique index', async () => {
  const created = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: { ...termsFor(f, 'Context employee'), user_id: f.userId },
  });
  const context = await f.db.withTenant(f.company, (tx) => employeeContext(tx, f.company, created));
  expect(context).toEqual({
    businessExists: true,
    branchBusinessId: f.business,
  });
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT business_id,user_id FROM employees
      WHERE company_id=${f.company} AND business_id=${f.business} AND user_id=${f.userId} AND deleted_at IS NULL`);
  });
  expect(JSON.stringify(plan)).toContain('employees_active_user_business_key');
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('employee detail projects the contract shape and uses tenant/business index', async () => {
  const created = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f),
  });
  expect(await detailFor(f, f.company, f.business, created.id)).toMatchObject(created);
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT id,business_id,primary_branch_id,user_id,name_ar,name_en,role_code,
      to_char(hire_date,'YYYY-MM-DD'),to_char(contract_end,'YYYY-MM-DD'),
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      FROM employees WHERE company_id=${f.company} AND business_id=${f.business} AND id=${created.id} AND deleted_at IS NULL`);
  });
  expect(JSON.stringify(plan)).toMatch(/employees_(company_business_id_(idx|key)|pkey)/);
});
