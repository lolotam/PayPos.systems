import { createdEmployee } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { CreateEmployeeUseCase } from '../use-cases/create-employee/create-employee.usecase.ts';
import {
  assignFixture,
  createdCounts,
  detailFor,
  employeeNumberIds,
  employeeUserMembership,
  executeCreate,
  grantEmployeeCreation,
  insertHeldNumbers,
  provisionEmployer,
  readCounter,
  sendCreate,
  setCounter,
  termsFor,
  type EmployeeFixture,
} from './employee-number-assign.fixture.ts';

let f: EmployeeFixture;
beforeAll(async () => {
  f = await assignFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function referenceFree(counter: number, used: readonly number[]) {
  const taken = new Set(used);
  for (let candidate = counter; candidate <= 999_999; candidate += 1) {
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('reference exhausted');
}

it('EN-03 creates the counter at 1 and keeps the response, audit and row on that number', async () => {
  expect(await readCounter(f, f.otherCompany)).toBeNull();
  const response = await sendCreate(
    f,
    {
      primary_branch_id: f.foreignBranch,
      name_en: 'First numbered',
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
    f.foreignBusiness,
    f.otherCompany,
  );
  expect(response.status).toBe(201);
  const record = createdEmployee.parse(response.body);
  expect(record.employee_number).toBe(1);
  expect(await readCounter(f, f.otherCompany)).toBe(2);
  expect(
    await f.h
      .owner`SELECT actor_user_id, action, after FROM audit_log WHERE company_id=${f.otherCompany} AND entity='employee' AND entity_id=${record.id}`,
  ).toEqual([{ actor_user_id: f.userId, action: 'created', after: record }]);
  expect(
    await f.h
      .owner`SELECT employee_number FROM employees WHERE company_id=${f.otherCompany} AND id=${record.id}`,
  ).toEqual([{ employee_number: 1 }]);
});

it('an unauthorised caller is refused and creates no sequence row', async () => {
  expect(await readCounter(f)).toBeNull();
  const response = await sendCreate(f, termsFor(f, 'Unauthorised'));
  expect(response.status).toBe(403);
  expect(response.body['code']).toBe('FORBIDDEN');
  expect(await readCounter(f)).toBeNull();
});

it('an unauthorised caller of an exhausted company does not move the counter', async () => {
  await setCounter(f, 1_000_000);
  const response = await sendCreate(f, termsFor(f, 'Unauthorised exhausted'));
  expect(response.status).toBe(403);
  expect(response.body['code']).toBe('FORBIDDEN');
  expect(await readCounter(f)).toBe(1_000_000);
});

it('a disabled feature is refused without moving an exhausted counter', async () => {
  await grantEmployeeCreation(f);
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.company},'staff',false,'Synthetic denial',${f.userId})`;
  const response = await sendCreate(f, termsFor(f, 'Feature off'));
  expect(response.status).toBe(403);
  expect(response.body['code']).toBe('FEATURE_DISABLED');
  expect(await readCounter(f)).toBe(1_000_000);
  await f.h
    .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  await setCounter(f, 1);
});

it('skips used, deleted and other-business numbers, and ignores another company', async () => {
  await setCounter(f, 100);
  await insertHeldNumbers(f, 100, 2);
  expect((await executeCreate(f, 'Skip held')).employee_number).toBe(102);
  await setCounter(f, 200);
  await insertHeldNumbers(f, 200, 1, { deleted: true });
  expect((await executeCreate(f, 'Skip deleted')).employee_number).toBe(201);
  await setCounter(f, 300);
  await insertHeldNumbers(f, 300, 1, { businessId: f.secondBusiness, branchId: f.otherBranch });
  expect((await executeCreate(f, 'Skip other business')).employee_number).toBe(301);
  const otherBefore = await readCounter(f, f.otherCompany);
  await setCounter(f, 400);
  await insertHeldNumbers(f, 400, 1, {
    companyId: f.otherCompany,
    businessId: f.foreignBusiness,
    branchId: f.foreignBranch,
  });
  expect((await executeCreate(f, 'Not blocked elsewhere')).employee_number).toBe(400);
  expect(await readCounter(f, f.otherCompany)).toBe(otherBefore);
});

it('walks a run longer than a page and a run that ends on the page boundary', async () => {
  await setCounter(f, 1000);
  await insertHeldNumbers(f, 1000, 300);
  await insertHeldNumbers(f, 1301, 1);
  const used = [...Array.from({ length: 300 }, (_, index) => 1000 + index), 1301];
  const afterRun = await executeCreate(f, 'After the run');
  expect(afterRun.employee_number).toBe(referenceFree(1000, used));
  expect(afterRun.employee_number).toBe(1300);
  await setCounter(f, 2000);
  await insertHeldNumbers(f, 2000, 256);
  const boundary = await executeCreate(f, 'After the page');
  const page = Array.from({ length: 256 }, (_, index) => 2000 + index);
  expect(boundary.employee_number).toBe(referenceFree(2000, page));
  expect(boundary.employee_number).toBe(2256);
});

it('refuses a full last page and leaves the counter and rows untouched', async () => {
  const fresh = await provisionEmployer(f, 'Full last page');
  await setCounter(f, 999_744, fresh.companyId);
  await insertHeldNumbers(f, 999_744, 256, {
    companyId: fresh.companyId,
    businessId: fresh.businessId,
    branchId: fresh.branchId,
  });
  const before = await createdCounts(f, fresh.companyId);
  const response = await sendCreate(
    f,
    {
      primary_branch_id: fresh.branchId,
      name_en: 'No room at the top',
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
    fresh.businessId,
    fresh.companyId,
  );
  expect(response.status).toBe(422);
  expect(response.body['code']).toBe('EMPLOYEE_NUMBER_EXHAUSTED');
  expect(await readCounter(f, fresh.companyId)).toBe(999_744);
  expect(await createdCounts(f, fresh.companyId)).toEqual(before);
});

it('keeps one company counter still when another company creates an employee', async () => {
  await setCounter(f, 6000);
  await setCounter(f, 7000, f.otherCompany);
  const created = await executeCreate(f, 'Tenant A');
  expect(created.employee_number).toBe(6000);
  expect(await readCounter(f)).toBe(6001);
  expect(await readCounter(f, f.otherCompany)).toBe(7000);
});

it('employee detail still reads a freshly numbered employee', async () => {
  const created = await executeCreate(f, 'Detail numbered');
  const detail = await detailFor(f, f.company, f.business, created.id);
  expect(detail).toMatchObject({
    id: created.id,
    name_en: 'Detail numbered',
    employee_number: created.employee_number,
  });
});

it('EN-12 gives 999999 then refuses, and ignores holes below a full top window', async () => {
  await setCounter(f, 999_999, f.otherCompany);
  const last = await sendCreate(
    f,
    {
      primary_branch_id: f.foreignBranch,
      name_en: 'Last number',
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
    f.foreignBusiness,
    f.otherCompany,
  );
  expect(last.status).toBe(201);
  expect(createdEmployee.parse(last.body).employee_number).toBe(999_999);
  expect(await readCounter(f, f.otherCompany)).toBe(1_000_000);
  const before = await createdCounts(f, f.otherCompany);
  const refused = await sendCreate(
    f,
    {
      primary_branch_id: f.foreignBranch,
      name_en: 'Past the last number',
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
    f.foreignBusiness,
    f.otherCompany,
  );
  expect(refused.status).toBe(422);
  expect(refused.body).toMatchObject({
    code: 'EMPLOYEE_NUMBER_EXHAUSTED',
    message_ar: 'نفدت الأرقام الوظيفية المتاحة في الشركة، فلا يمكن إسناد رقم تلقائي جديد.',
    message_en:
      'The company has no free employee numbers left, so none can be assigned automatically.',
  });
  expect(await createdCounts(f, f.otherCompany)).toEqual(before);
  expect(await readCounter(f, f.otherCompany)).toBe(1_000_000);
  await setCounter(f, 999_997);
  await insertHeldNumbers(f, 999_997, 3);
  const companyBefore = await createdCounts(f);
  const window = await sendCreate(f, termsFor(f, 'No number above the counter'));
  expect(window.status).toBe(422);
  expect(window.body['code']).toBe('EMPLOYEE_NUMBER_EXHAUSTED');
  expect(await createdCounts(f)).toEqual(companyBefore);
  expect(await readCounter(f)).toBe(999_997);
});

it('a duplicate employee number is retryable and a duplicate user link stays linked', async () => {
  await setCounter(f, 8000);
  const first = await executeCreate(f, 'Owned number');
  const forcing = new CreateEmployeeUseCase(
    {
      run: (actor, work) =>
        f.transactions.run(actor, (scope) =>
          work({ ...scope, assignEmployeeNumber: async () => 8000 }),
        ),
    },
    employeeNumberIds,
    { now: () => new Date('2026-10-17T00:00:00Z') },
  );
  await expect(
    forcing.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: termsFor(f, 'Repeated number'),
    }),
  ).rejects.toThrow('TRANSACTION_RETRY_REQUIRED');
  expect(first.employee_number).toBe(8000);
  expect(await readCounter(f)).toBe(8001);
  const userId = employeeNumberIds.newId();
  await f.h
    .owner`INSERT INTO "user"(id,name,email) VALUES (${userId},'Synthetic link',${`link-${userId}@example.test`})`;
  await employeeUserMembership(f, userId);
  await executeCreate(f, 'Linked once', { user_id: userId });
  expect(await readCounter(f)).toBe(8002);
  await expect(executeCreate(f, 'Linked twice', { user_id: userId })).rejects.toThrow(
    'EMPLOYEE_USER_ALREADY_LINKED',
  );
  expect(await readCounter(f)).toBe(8002);
});

function withRealParameters(statement: string, params: readonly unknown[]): string {
  return statement.replace(/\$(\d+)\b/g, (_match, index: string) => {
    const value = params[Number(index) - 1];
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return value;
    if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) return `'${value}'`;
    throw new Error(`unexpected scan parameter ${index}`);
  });
}

it('the used-number page scans employees_company_employee_number_key', async () => {
  await setCounter(f, 8100);
  const start = f.h.calls.statements.length;
  const response = await sendCreate(f, termsFor(f, 'Explain scan'));
  expect(response.status).toBe(201);
  const scans = f.h.calls.statements
    .slice(start)
    .filter((entry) => /from employees/i.test(entry.sql) && /employee_number >=/.test(entry.sql));
  expect(scans).toHaveLength(1);
  const scan = scans[0];
  if (scan === undefined) throw new Error('missing page scan');
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const plan = await tx.execute(
      sql`EXPLAIN ${sql.raw(withRealParameters(scan.sql, scan.params))}`,
    );
    expect(plan.map((row) => String(row['QUERY PLAN'])).join('\n')).toContain(
      'employees_company_employee_number_key',
    );
  });
});
