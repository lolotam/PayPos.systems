import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { defaultHoursFixture, type DefaultHoursFixture } from './employee-default-shifts.fixture.ts';
import { salaryCommand, salaryIds } from './salary.fixture.ts';
import { createEmployeeCards } from '../persistence/drizzle-employee-cards.ts';
import { createEmployeeCardAccess } from '../persistence/employee-card-access.adapter.ts';
import { createEmployeeIbanTransactions } from '../persistence/drizzle-employee-iban-transactions.ts';
import { createUnbindPasskeyTransactions } from '../persistence/unbind-passkey-transactions.ts';
import { currentAttachment } from '@pospay/db';
import { employeeDefaultShifts } from '../queries/employee-default-shifts.query.ts';
import { createEmployeeHoursReadAccess } from '../persistence/employee-default-shifts.adapter.ts';
import { sql } from 'drizzle-orm';

let f: DefaultHoursFixture;
let now: Date;
beforeAll(async () => {
  f = await defaultHoursFixture();
  const [instant] = await f.h.owner`SELECT CURRENT_TIMESTAMP AS now`;
  now = new Date(instant?.['now'] as string);
  const role = salaryIds.newId();
  await f.h.owner`INSERT INTO roles(company_id,id,code,name_en)
    VALUES(${f.company},${role},'synthetic_branch_link_reader','Synthetic branch reader')`;
  await f.h.owner`UPDATE memberships SET role_id=${role},role_owner_key=${f.company},
    scope_type='BRANCH',scope_id=${f.branch} WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.memberId}`;
  for (const permission of ['manage:employees:business', 'read:salaries:business',
    'manage:salaries:business', 'read:passkeys:branch', 'unbind:passkeys:branch']) {
    await f.h.owner`INSERT INTO permission_overrides
      (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.company},${salaryIds.newId()},${f.memberId},${permission},'ALLOW','BRANCH',${f.branch},
        'Synthetic branch-only grant',${f.userId})`;
  }
  await f.h.owner`UPDATE branches SET timezone='Pacific/Honolulu' WHERE company_id=${f.company} AND id=${f.secondBranch}`;
});
afterAll(async () => { await f?.db.close(); await f?.h.close(); });
beforeEach(async () => { await endLink(30); });

async function endLink(offset: number, timezone = 'Pacific/Honolulu') {
  await f.h.owner`DELETE FROM employee_branches WHERE company_id=${f.company}
    AND employee_id=${f.employee.id} AND branch_id=${f.secondBranch}`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${f.company},${salaryIds.newId()},${f.business},${f.employee.id},${f.secondBranch},
      (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date-1,
      (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date+${offset}::integer)`;
}
function send(method: 'GET' | 'POST', suffix = '', body?: object) {
  return f.h.send(method, `/v1/businesses/${f.business}/employees/${f.employee.id}${suffix}`, {
    cookie: f.cookie, company: f.company, ...(body === undefined ? {} : { body }),
  });
}

it.each([
  ['EmployeeDetailGuard', ''], ['employeeIbanDecision', '/iban'],
  ['employeeIbanHistory', '/iban/history'], ['salaryHistory', '/salaries'],
  ['readEmployeeCards', '/cards'], ['employeeDefaultShifts', '/default-shifts'],
  ['managerPasskeyEmployee', '/passkeys'],
])('%s refuses a finite current link to B; an exclusive end today permits A', async (_name, suffix) => {
  const denied = await send('GET', suffix);
  expect(denied.status).toBe(404);
  expect(denied.body['code']).toBe('NOT_FOUND');
  await endLink(0);
  expect((await send('GET', suffix)).status).toBe(200);
});

it('listEmployees hides a finite current B link and includes the employee once B ends today', async () => {
  const list = () => f.h.send('GET', `/v1/businesses/${f.business}/employees`, { cookie: f.cookie, company: f.company });
  expect((await list()).body['items']).toEqual([]);
  await endLink(0);
  expect((await list()).body['items']).toEqual([expect.objectContaining({ id: f.employee.id })]);
});

it('employeeNameMatches exposes only hidden_exists for a finite current B link, then the ended match', async () => {
  const matches = () => f.h.send('POST', `/v1/businesses/${f.business}/employees/name-matches`, {
    cookie: f.cookie, company: f.company, body: { name_en: 'Synthetic employee' },
  });
  expect((await matches()).body).toMatchObject({ matches: [], visible_total: 0, hidden_exists: true });
  await endLink(0);
  expect((await matches()).body).toMatchObject({
    matches: [expect.objectContaining({ id: f.employee.id })], visible_total: 1, hidden_exists: false,
  });
});

it('default-hours query independently refuses the finite current B link before returning its view', async () => {
  const read = () => f.db.withTenant(f.company, (tx) =>
    employeeDefaultShifts(tx, f.context, createEmployeeHoursReadAccess()));
  expect(await read()).toBeNull();
  await endLink(0);
  expect(await read()).toMatchObject({ employee_id: f.employee.id });
});

it('salary write scope refuses a finite current B link and permits the ended B link', async () => {
  await expect(f.set.execute(salaryCommand(f))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await endLink(0);
  expect(await f.set.execute(salaryCommand(f))).toMatchObject({ employee_id: f.employee.id });
});

it('IBAN write scope refuses a finite current B link and permits the ended B link', async () => {
  const transactions = createEmployeeIbanTransactions(f.db, salaryIds);
  const work = async () => 'authorized';
  await expect(transactions.run(f.context, work)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await endLink(0);
  expect(await transactions.run(f.context, work)).toBe('authorized');
});

it.each(['issue', 'revoke'] as const)('card %s write scope refuses a finite current B link and permits the ended B link', async (operation) => {
  const cards = createEmployeeCards(f.db, salaryIds, { now: () => now }, createEmployeeCardAccess(),
    () => 'a'.repeat(64));
  const scope = { ...f.context, operatorId: f.userId };
  let cardId = salaryIds.newId();
  const command = () => operation === 'issue'
    ? cards.issue(scope, 'SYNTHETIC-CARD-156', { key: salaryIds.newId(), fingerprint: 'b'.repeat(64) })
    : cards.revoke(scope, cardId, { key: salaryIds.newId(), fingerprint: 'b'.repeat(64) });
  await expect(command()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await endLink(0);
  if (operation === 'revoke') cardId = (await cards.issue(scope, 'SYNTHETIC-CARD-156',
    { key: salaryIds.newId(), fingerprint: 'b'.repeat(64) })).id;
  expect(await command()).toMatchObject({ employeeId: f.employee.id });
});

it('unbind persistence scope uses injected branch days for finite current and ended B links', async () => {
  const transactions = createUnbindPasskeyTransactions(f.db, salaryIds, { now: () => now });
  const work = async () => 'authorized';
  await expect(transactions.run(f.context, work)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await endLink(0);
  expect(await transactions.run(f.context, work)).toBe('authorized');
});

it('shared predicate uses injected branch days, exclusive ends and unknown-day fail-closed behavior', async () => {
  const [days] = await f.h.owner`SELECT to_char("to"-1,'YYYY-MM-DD') AS before,
    to_char("to",'YYYY-MM-DD') AS today,to_char("to"+1,'YYYY-MM-DD') AS after
    FROM employee_branches WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.secondBranch}`;
  const matches = (days: readonly { branchId: string; today: string }[]) => f.db.withTenant(f.company,
    (tx) => tx.execute(sql`SELECT eb.branch_id FROM employee_branches eb WHERE eb.company_id=${f.company}
      AND eb.employee_id=${f.employee.id} AND eb.branch_id=${f.secondBranch} AND ${currentAttachment(days)}`));
  expect(await matches([{ branchId: f.secondBranch, today: String(days?.['before']) }])).toHaveLength(1);
  expect(await matches([{ branchId: f.secondBranch, today: String(days?.['today']) }])).toHaveLength(0);
  expect(await matches([{ branchId: f.secondBranch, today: String(days?.['after']) }])).toHaveLength(0);
  expect(await matches([])).toHaveLength(1);
});

it.each(['Pacific/Honolulu', 'Pacific/Kiritimati', null])('SQL predicate uses branch timezone %s with business fallback', async (timezone) => {
  await f.h.owner`UPDATE branches SET timezone=${timezone} WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  const effective = timezone ?? 'Asia/Kuwait';
  const read = () => f.db.withTenant(f.company, (tx) => tx.execute(sql`SELECT eb.branch_id
    FROM employee_branches eb WHERE eb.company_id=${f.company} AND eb.employee_id=${f.employee.id}
      AND eb.branch_id=${f.secondBranch} AND ${currentAttachment()}`));
  await endLink(0, effective);
  expect(await read()).toHaveLength(0);
  await endLink(1, effective);
  expect(await read()).toHaveLength(1);
});
