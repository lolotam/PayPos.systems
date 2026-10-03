import { employee } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
const employeeIds = systemUuidV7();
import { afterAll, beforeAll, expect, it } from 'vitest';
import { CreateEmployeeUseCase } from '../use-cases/create-employee/create-employee.usecase.ts';
import {
  employeesFixture,
  grantEmployeeCreation,
  detailFor,
  employeeUserMembership,
  termsFor,
  type EmployeeFixture,
} from './employees.fixture.ts';

let f: EmployeeFixture;
let createdId: string;
beforeAll(async () => {
  f = await employeesFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const send = (body: object, business = f.business) =>
  f.h.send('POST', `/v1/businesses/${business}/employees`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const execute = (
  input: ReturnType<typeof termsFor> & { user_id?: string; contract_end?: string },
) => f.useCase.execute({ companyId: f.company, userId: f.userId, businessId: f.business, input });

it('CE-03 grants employee management to managers; custom editor needs an explicit grant', async () => {
  expect(
    await f.h
      .owner`SELECT 1 FROM role_permissions WHERE permission_code='manage:employees:business'`,
  ).toHaveLength(3);
  expect((await send(termsFor(f))).status).toBe(403);
  expect(
    (
      await f.h.app.inject({
        method: 'POST',
        url: `/v1/businesses/${f.business}/employees`,
        payload: termsFor(f),
      })
    ).statusCode,
  ).toBe(401);
  await grantEmployeeCreation(f);
});
it('CE-01 creates UUIDv7 employee + dated primary attachment + allowlisted audit', async () => {
  const result = await send({
    ...termsFor(f),
    name_ar: 'موظفة تجريبية',
    contract_end: '2027-01-01',
  });
  expect(result.status).toBe(201);
  const record = employee.parse(result.body);
  createdId = record.id;
  expect(record.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-7/);
  expect(record).toMatchObject({
    ...termsFor(f),
    business_id: f.business,
    name_ar: 'موظفة تجريبية',
    user_id: null,
  });
  expect(
    await f.h
      .owner`SELECT business_id,employee_id,branch_id,"from"::text,"to" FROM employee_branches WHERE company_id=${f.company} AND employee_id=${createdId}`,
  ).toEqual([
    {
      business_id: f.business,
      employee_id: createdId,
      branch_id: f.branch,
      from: '2026-01-01',
      to: null,
    },
  ]);
  expect(
    await f.h
      .owner`SELECT actor_user_id,action,after FROM audit_log WHERE company_id=${f.company} AND entity='employee' AND entity_id=${createdId}`,
  ).toEqual([{ actor_user_id: f.userId, action: 'created', after: record }]);
  expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${createdId}`).toHaveLength(0);
  expect(await detailFor(f, f.company, f.business, createdId)).toMatchObject(record);
});
it.each([
  [
    'foreign branch',
    (x: EmployeeFixture) => ({ primary_branch_id: x.foreignBranch }),
    'EMPLOYEE_BRANCH_NOT_FOUND',
  ],
  [
    'different business branch',
    (x: EmployeeFixture) => ({ primary_branch_id: x.otherBranch }),
    'EMPLOYEE_BRANCH_NOT_FOUND',
  ],
  [
    'unknown branch',
    () => ({ primary_branch_id: employeeIds.newId() }),
    'EMPLOYEE_BRANCH_NOT_FOUND',
  ],
  ['unknown user', () => ({ user_id: employeeIds.newId() }), 'EMPLOYEE_USER_LINK_UNAVAILABLE'],
  [
    'contract before hire',
    () => ({ contract_end: '2025-12-31' }),
    'EMPLOYEE_CONTRACT_END_BEFORE_HIRE',
  ],
] as const)('CE-02 refuses %s with no partial write', async (_name, change, code) => {
  const before = await f.h.owner`SELECT count(*) AS n FROM employees`;
  const response = await send({ ...termsFor(f, employeeIds.newId()), ...change(f) });
  expect(response.body['code']).toBe(code);
  expect(response.status).toBe(code === 'EMPLOYEE_BRANCH_NOT_FOUND' ? 404 : 400);
  expect(response.body['message_ar']).toEqual(expect.any(String));
  expect(response.body['message_en']).toEqual(expect.any(String));
  expect(await f.h.owner`SELECT count(*) AS n FROM employees`).toEqual(before);
});
it('CE-04 creation grants no access, even when a user is linked (owner decision 2026-10-03)', async () => {
  const before = await f.h
    .owner`SELECT id,role_id,user_id,employee_id FROM memberships ORDER BY id`;
  const permissions = await f.h.owner`SELECT * FROM permission_overrides ORDER BY id`;
  const defaults = await f.h.owner`SELECT * FROM role_permissions ORDER BY role_id,permission_code`;
  const record = await execute({ ...termsFor(f, 'Linked employee'), user_id: f.userId });
  expect(record.user_id).toBe(f.userId);
  expect(
    await f.h.owner`SELECT id,role_id,user_id,employee_id FROM memberships ORDER BY id`,
  ).toEqual(before);
  expect(await f.h.owner`SELECT * FROM permission_overrides ORDER BY id`).toEqual(permissions);
  expect(await f.h.owner`SELECT * FROM role_permissions ORDER BY role_id,permission_code`).toEqual(
    defaults,
  );
});
it('CE-07 serializes competing user links and keeps one creation audit', async () => {
  const userId = employeeIds.newId();
  await f.h
    .owner`INSERT INTO "user"(id,name,email) VALUES (${userId},'Synthetic link','employee-link@example.test')`;
  await employeeUserMembership(f, userId);
  const results = await Promise.allSettled(
    ['Link A', 'Link B'].map((name) => execute({ ...termsFor(f, name), user_id: userId })),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const failed = results.find((r) => r.status === 'rejected');
  expect(failed?.status === 'rejected' ? (failed.reason as Error).message : null).toBe(
    'EMPLOYEE_USER_ALREADY_LINKED',
  );
  expect(await f.h.owner`SELECT id FROM employees WHERE user_id=${userId}`).toHaveLength(1);
  expect(
    await f.h
      .owner`SELECT a.id FROM audit_log a JOIN employees e ON e.company_id=a.company_id AND e.id=a.entity_id
    WHERE e.company_id=${f.company} AND e.user_id=${userId} AND a.entity='employee' AND a.action='created'`,
  ).toHaveLength(1);
  const refused = await send({ ...termsFor(f, 'Duplicate linked user'), user_id: userId });
  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({
    code: 'EMPLOYEE_USER_ALREADY_LINKED',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
});
it('CE-08 duplicate names and future hires are allowed with correctly dated attachments', async () => {
  const body = { ...termsFor(f), hire_date: '2999-01-01', contract_end: '2999-01-01' };
  const first = await send(body),
    second = await send(body);
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(first.body['id']).not.toBe(second.body['id']);
  for (const record of [first.body, second.body]) {
    expect(record['hire_date']).toBe('2999-01-01');
    expect(
      await f.h
        .owner`SELECT "from"::text FROM employee_branches WHERE company_id=${f.company} AND employee_id=${record['id'] as string}`,
    ).toEqual([{ from: '2999-01-01' }]);
  }
});
it('CE-09 the same user can work in different businesses; soft deletion releases its previous link', async () => {
  await grantEmployeeCreation(f, f.secondBusiness);
  const response = await send(
    {
      ...termsFor(f, 'Second business employee'),
      primary_branch_id: f.otherBranch,
      user_id: f.userId,
    },
    f.secondBusiness,
  );
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ business_id: f.secondBusiness, user_id: f.userId });
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND business_id=${f.business} AND user_id=${f.userId}`;
  const replacement = await send({ ...termsFor(f, 'Replacement employee'), user_id: f.userId });
  expect(replacement.status).toBe(201);
});
it('CE-05 rolls back employee and attachment when audit fails', async () => {
  const transactions = {
    run: <T>(
      actor: { companyId: string; userId: string },
      work: Parameters<typeof f.transactions.run<T>>[1],
    ) =>
      f.transactions.run(actor, (scope) =>
        work({
          ...scope,
          audit: async () => {
            throw new Error('Synthetic audit failure');
          },
        }),
      ),
  };
  const failing = new CreateEmployeeUseCase(transactions, employeeIds, {
    now: () => new Date('2026-10-03T00:00:00Z'),
  });
  const before = await f.h.owner`SELECT count(*) AS n FROM employee_branches`;
  await expect(
    failing.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: termsFor(f, 'Rollback employee'),
    }),
  ).rejects.toThrow('EMPLOYEE_PERSISTENCE_FAILED');
  expect(await f.h.owner`SELECT 1 FROM employees WHERE name_en='Rollback employee'`).toHaveLength(
    0,
  );
  expect(await f.h.owner`SELECT count(*) AS n FROM employee_branches`).toEqual(before);
});
it('CE-06 detail isolates tenant, business and soft-deleted records', async () => {
  expect(await detailFor(f, f.otherCompany, f.business, createdId)).toBeNull();
  expect(await detailFor(f, f.company, f.secondBusiness, createdId)).toBeNull();
  const record = await execute(termsFor(f, 'Deleted employee'));
  await f.h.owner`UPDATE employees SET deleted_at=now() WHERE id=${record.id}`;
  expect(await detailFor(f, f.company, f.business, record.id)).toBeNull();
});
it('malformed roles, names, dates and claims return validation envelope', async () => {
  for (const change of [
    { role_code: 'device' },
    { name_en: '  ' },
    { hire_date: '2026-02-30' },
    { company_id: f.company },
  ])
    expect((await send({ ...termsFor(f), ...change })).body['code']).toBe('VALIDATION_FAILED');
});
