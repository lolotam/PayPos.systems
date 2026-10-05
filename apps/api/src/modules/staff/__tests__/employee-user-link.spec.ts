import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  employeesFixture,
  employeeUserMembership,
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

async function syntheticUser() {
  const userId = ids.newId();
  await f.h
    .owner`INSERT INTO "user"(id,name,email) VALUES (${userId},'Synthetic link',${`${userId}@example.test`})`;
  return userId;
}
const send = (userId: string) =>
  f.h.send('POST', `/v1/businesses/${f.business}/employees`, {
    cookie: f.cookie,
    company: f.company,
    body: { ...termsFor(f), user_id: userId },
  });
const counts = () => f.h.owner`SELECT
  (SELECT count(*) FROM employees) AS employees,
  (SELECT count(*) FROM employee_branches) AS attachments,
  (SELECT count(*) FROM audit_log WHERE entity='employee') AS audits`;

it('unknown and foreign-company users share the same 400 refusal with no writes', async () => {
  const foreignUser = await syntheticUser();
  await employeeUserMembership(f, foreignUser, { companyId: f.otherCompany });
  const before = await counts();
  const unknown = await send(ids.newId());
  const foreign = await send(foreignUser);
  expect(unknown.status).toBe(400);
  expect(foreign.status).toBe(400);
  expect(foreign.body).toEqual(unknown.body);
  expect(unknown.body).toMatchObject({
    code: 'EMPLOYEE_USER_LINK_UNAVAILABLE',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
  expect(await counts()).toEqual(before);
});
it.each([
  { startsAt: '2000-01-01T00:00:00Z', endsAt: '2001-01-01T00:00:00Z' },
  { startsAt: '2999-01-01T00:00:00Z' },
])('refuses inactive company membership %j', async (window) => {
  const userId = await syntheticUser();
  await employeeUserMembership(f, userId, window);
  const before = await counts();
  expect(await send(userId)).toMatchObject({
    status: 400,
    body: { code: 'EMPLOYEE_USER_LINK_UNAVAILABLE' },
  });
  expect(await counts()).toEqual(before);
});
it('accepts an active membership in another business of this company without changing access', async () => {
  const userId = await syntheticUser();
  await employeeUserMembership(f, userId, { businessId: f.secondBusiness });
  const before = await f.h.owner`SELECT * FROM memberships WHERE user_id=${userId}`;
  expect(await send(userId)).toMatchObject({
    status: 201,
    body: { user_id: userId, business_id: f.business },
  });
  expect(await f.h.owner`SELECT * FROM memberships WHERE user_id=${userId}`).toEqual(before);
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT EXISTS(SELECT 1 FROM memberships
      WHERE company_id=${f.company} AND user_id=${userId} AND starts_at <= statement_timestamp()
        AND (ends_at IS NULL OR ends_at > statement_timestamp())) AS available`);
  });
  expect(JSON.stringify(plan)).toMatch(
    /memberships_(user_id_idx|pkey|scope_branch_idx|scope_business_idx|company_id_employee_id_idx)/,
  );
  expect(JSON.stringify(plan)).toContain('Index Cond');
});
it('rechecks target membership activity after waiting on the ordered membership locks', async () => {
  const userId = await syntheticUser();
  const membershipId = await employeeUserMembership(f, userId);
  let signal!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = f.h.owner.begin(async (tx) => {
    await tx`UPDATE memberships SET ends_at=clock_timestamp() WHERE company_id=${f.company} AND id=${membershipId}`;
    signal();
    await ready;
  });
  await locked;
  const request = f.useCase
    .execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: { ...termsFor(f, 'Ended target link'), user_id: userId },
    })
    .catch((error: unknown) => error);
  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await vi.waitFor(
      async () => {
        const waits = await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%memberships%FOR UPDATE%'`;
        expect(waits.length).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 20 },
    );
  } finally {
    release();
    await writer;
    await observer.end();
  }
  expect(await request).toMatchObject({ message: 'EMPLOYEE_USER_LINK_UNAVAILABLE' });
  expect(await f.h.owner`SELECT 1 FROM employees WHERE user_id=${userId}`).toHaveLength(0);
});
