import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  employeesFixture,
  grantEmployeeCreation,
  termsFor,
  type EmployeeFixture,
} from './employees.fixture.ts';

const ids = systemUuidV7();
let f: EmployeeFixture;
let employeeId: string;

beforeAll(async () => {
  f = await employeesFixture();
  await grantEmployeeCreation(f);
  employeeId = (
    await f.useCase.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: termsFor(f),
    })
  ).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const cardsPath = (employee = employeeId) =>
  `/v1/businesses/${f.business}/employees/${employee}/cards`;
const send = (method: 'GET' | 'POST', path: string, body?: object, key?: string) =>
  f.h.send(method, path, {
    cookie: f.cookie,
    company: f.company,
    ...(key === undefined ? {} : { key }),
    ...(body === undefined ? {} : { body }),
  });
const list = (employee = employeeId) => send('GET', cardsPath(employee));
const issue = (employee: string, code: string) =>
  send('POST', cardsPath(employee), { card_code: code }, ids.newId());
const revoke = (employee: string, cardId: string) =>
  send('POST', `${cardsPath(employee)}/${cardId}/revoke`, undefined, ids.newId());

async function grants(rows: readonly ['ALLOW' | 'DENY', 'BUSINESS' | 'BRANCH', string][]) {
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company}
    AND membership_id=${f.memberId} AND permission_code='manage:employees:business'`;
  for (const [effect, scope, scopeId] of rows) {
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.company},${ids.newId()},${f.memberId},'manage:employees:business',${effect},${scope},${scopeId},'Synthetic card scope',${f.userId})`;
  }
}

async function sameAsMissing(
  run: (employee: string) => Promise<{ status: number; body: Record<string, unknown> }>,
) {
  const refused = await run(employeeId);
  const missing = await run(ids.newId());
  expect(refused.status).toBe(404);
  expect(refused.body).toEqual(missing.body);
  expect(refused.body['code']).toBe('NOT_FOUND');
}

it('business ALLOW plus branch DENY hides list, issue and revoke like a missing employee', async () => {
  await grants([['ALLOW', 'BUSINESS', f.business]]);
  const issued = await issue(employeeId, 'CARD-OK-1001');
  expect(issued.status).toBe(200);
  const cardId = issued.body['id'] as string;
  await grants([
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BRANCH', f.branch],
  ]);
  await sameAsMissing(list);
  await sameAsMissing((employee) => issue(employee, 'CARD-NO-1002'));
  await sameAsMissing((employee) => revoke(employee, cardId));
  const [row] = await f.h.owner`SELECT revoked_at::text AS revoked_at,
    (SELECT count(*) FROM employee_cards WHERE company_id=${f.company} AND employee_id=${employeeId}
      AND revoked_at IS NULL) AS active
    FROM employee_cards WHERE company_id=${f.company} AND id=${cardId}`;
  expect(row?.['revoked_at']).toBeNull();
  expect(Number(row?.['active'])).toBe(1);
});

it('branch ALLOW on the employee branch lists, issues and revokes the card', async () => {
  await grants([['ALLOW', 'BRANCH', f.branch]]);
  const listed = await list();
  expect(listed.status).toBe(200);
  expect(listed.body['can_manage']).toBe(true);
  const issued = await issue(employeeId, 'CARD-OK-2002');
  expect(issued.status).toBe(200);
  const revoked = await revoke(employeeId, issued.body['id'] as string);
  expect(revoked.status).toBe(200);
  expect(typeof revoked.body['revoked_at']).toBe('string');
});
