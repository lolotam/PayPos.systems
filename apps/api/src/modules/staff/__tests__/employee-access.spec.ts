import { systemUuidV7 } from '@pospay/ids';
import { OWNER_ROLE_ID } from '@pospay/db';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  employeesFixture,
  grantEmployeeCreation,
  termsFor,
  type EmployeeFixture,
} from './employees.fixture.ts';

const ids = systemUuidV7();
let f: EmployeeFixture;
beforeAll(async () => {
  f = await employeesFixture();
  await grantEmployeeCreation(f);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const execute = (name: string, businessId = f.business) =>
  f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId,
    input: termsFor(f, name),
  });

it('denies another business and another tenant before writing', async () => {
  await expect(execute('Other business', f.secondBusiness)).rejects.toThrow('FORBIDDEN');
  await expect(
    f.useCase.execute({
      companyId: f.otherCompany,
      userId: f.userId,
      businessId: f.business,
      input: termsFor(f),
    }),
  ).rejects.toThrow('FORBIDDEN');
});
it('applies a branch DENY while business ALLOW remains held', async () => {
  const deny = ids.newId();
  await f.h
    .owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${deny},${f.memberId},'manage:employees:business','DENY','BRANCH',${f.branch},'Synthetic denial',${f.userId})`;
  try {
    await expect(execute('Denied branch')).rejects.toThrow('FORBIDDEN');
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${deny}`;
  }
});
it('names a missing business when an explicit company grant covers the target', async () => {
  const grant = ids.newId();
  await f.h
    .owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${grant},${f.memberId},'manage:employees:business','ALLOW','COMPANY',${f.company},'Synthetic grant',${f.userId})`;
  try {
    await expect(execute('Missing business', ids.newId())).rejects.toThrow(
      'EMPLOYEE_BUSINESS_NOT_FOUND',
    );
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE id=${grant}`;
  }
});
it('takes the company lock then ordered membership locks before employee writes and audit', async () => {
  const start = f.h.calls.statements.length;
  const response = await f.h.send('POST', `/v1/businesses/${f.business}/employees`, {
    cookie: f.cookie,
    company: f.company,
    body: termsFor(f, 'Lock protocol employee'),
  });
  expect(response.status).toBe(201);
  const sql = f.h.calls.statements.slice(start).map((s) => s.sql);
  const company = sql.findIndex((s) => s.includes('FOR NO KEY UPDATE'));
  const members = sql.findIndex((s) => /memberships.*ORDER BY id FOR UPDATE/.test(s));
  const employee = sql.findIndex((s) => s.includes('INSERT INTO employees'));
  const audit = sql.findIndex((s) => s.includes('audit_log') && /insert/i.test(s));
  expect(company).toBeGreaterThanOrEqual(0);
  expect(members).toBeGreaterThan(company);
  expect(employee).toBeGreaterThan(members);
  expect(audit).toBeGreaterThan(employee);
  expect(
    (
      await f.h.send(
        'GET',
        `/v1/businesses/${f.business}/employees/${response.body['id'] as string}`,
        { cookie: f.cookie, company: f.company },
      )
    ).body,
  ).toMatchObject(response.body);
});
it('rechecks the ended membership after waiting for its lock, with no partial employee', async () => {
  const otherOwner = ids.newId();
  await f.h
    .owner`INSERT INTO "user"(id,name,email) VALUES (${otherOwner},'Synthetic owner','other-employee-owner@example.test')`;
  await f.h
    .owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${ids.newId()},${otherOwner},${OWNER_ROLE_ID},'global','COMPANY',${f.company})`;
  let signal!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = f.h.owner.begin(async (tx) => {
    await tx`UPDATE memberships SET ends_at=clock_timestamp() WHERE company_id=${f.company} AND id=${f.memberId}`;
    signal();
    await ready;
  });
  await locked;
  const request = execute('Membership ended while waiting');
  const settled = request.catch((error: unknown) => error);
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await vi.waitFor(
      async () => {
        const waits =
          await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%memberships%FOR UPDATE%'`;
        expect(waits.length).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 20 },
    );
  } finally {
    release();
    await writer;
    await observer.end();
  }
  expect(await settled).toMatchObject({ message: 'FORBIDDEN' });
  expect(
    await f.h.owner`SELECT 1 FROM employees WHERE name_en='Membership ended while waiting'`,
  ).toHaveLength(0);
});
