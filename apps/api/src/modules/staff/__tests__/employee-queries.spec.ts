import { employee } from '@pospay/contracts';
import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { takeTestEmployeeNumber } from '../../../../test/test-employee-number.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeContext } from '../persistence/employee-context.adapter.ts';
import {
  employeesFixture,
  grantEmployeeCreation,
  detailFor,
  termsFor,
  type EmployeeFixture,
} from './employees.fixture.ts';

const employeeIds = systemUuidV7();
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
  // من غير إحصائيات وبصف واحد الفهرسين بيتساووا في التكلفة، فالـ planner كان بيختار فهرس الاسم الجزئي (0204)
  // ويحط user_id في Filter. صفوف النشاط اللي من غير حساب دخول بتخلي الإحصائيات زي الواقع (PP-122).
  const fillers = Array.from({ length: 200 }, (_, i) => ({
    id: employeeIds.newId(),
    name_en: `Link filler ${i}`,
    name_en_key: employeeNameMatchKey(`Link filler ${i}`),
    employee_number: takeTestEmployeeNumber(f.company),
  }));
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${f.company},id,${f.business},${f.branch},name_en,name_en_key,'staff','2026-01-01',employee_number
    FROM jsonb_to_recordset(${f.h.owner.json(fillers)}) AS r(id uuid,name_en text,name_en_key text,employee_number int)`;
  await f.h.owner`ANALYZE employees`;
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT business_id,user_id FROM employees
      WHERE company_id=${f.company} AND business_id=${f.business} AND user_id=${f.userId} AND deleted_at IS NULL`);
  });
  expect(JSON.stringify(plan)).toMatch(
    /"Index Name":"employees_active_user_business_key"[^}]*"Index Cond":"[^"]*user_id = /,
  );
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
  expect(created.employee_number).toEqual(expect.any(Number));
  expect(await detailFor(f, f.company, f.business, created.id)).toMatchObject(
    employee.parse(created),
  );
  await f.h.owner`ANALYZE employees`;
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT id,business_id,primary_branch_id,user_id,name_ar,name_en,role_code,
      to_char(hire_date,'YYYY-MM-DD'),to_char(contract_end,'YYYY-MM-DD'),
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      FROM employees WHERE company_id=${f.company} AND business_id=${f.business} AND id=${created.id} AND deleted_at IS NULL`);
  });
  expect(JSON.stringify(plan)).toMatch(
    /employees_(company_business_(id_(idx|key)|name_(en|ar)_key_idx)|pkey)/,
  );
});
