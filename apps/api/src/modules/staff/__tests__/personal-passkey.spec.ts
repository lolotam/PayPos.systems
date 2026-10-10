import { createAttendanceDeviceRefusals } from '../persistence/attendance-device-refusals.ts';
import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { personalFixture, personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { phone } from '../../../../test/staff-otp-harness.ts';
import { testAuthenticator } from '../../../../../../packages/auth/src/__tests__/webauthn.fixture.ts';
import { present } from '../../../../../../packages/db/test/present.ts';
import { bindingStatusStatement } from '../queries/passkey-binding.query.ts';
import {
  passkeyBindingStatus,
  personalSessionContext,
  passkeyRegistrationOptions,
} from '@pospay/contracts';
import { createPasskeyTransactions } from '../persistence/passkey-transactions.ts';
import { EnrolPasskey } from '../use-cases/enrol-passkey/enrol-passkey.ts';

let f: Awaited<ReturnType<typeof personalFixture>>;
let cookie: string;
beforeAll(async () => {
  f = await personalFixture();
});
afterAll(async () => {
  await f?.close();
});
const headers = () => ({ cookie, origin: personalOrigin });
const scope = () => ({
  userId: f.userId,
  sessionId: 'unused',
  companyId: f.companyId,
  businessId: f.businessId,
  employeeId: f.employeeId,
});

it('phone + OTP issues a separate personal cookie; wrong workspace/code and replay cannot issue sessions', async () => {
  const request = await f.app.inject({
    method: 'POST',
    url: '/v1/staff/personal-otp/request',
    headers: { origin: personalOrigin },
    payload: { phone, locale: 'ar', company_id: f.companyId, business_id: f.businessId },
  });
  expect(request.statusCode).toBe(202);
  const challengeId = request.json().challenge_id as string;
  expect(f.jobs.some((job) => job.challengeId === challengeId)).toBe(true);
  const code = await f.code(challengeId);
  const payload = {
    challenge_id: challengeId,
    code,
    company_id: f.companyId,
    business_id: f.businessId,
  };
  const verify = (body: object) =>
    f.app.inject({
      method: 'POST',
      url: '/v1/staff/personal-otp/verify',
      headers: { origin: personalOrigin },
      payload: body,
    });
  expect((await verify({ ...payload, business_id: f.ids.newId() })).statusCode).toBe(401);
  const result = await verify(payload);
  expect(result.statusCode).toBe(200);
  expect(personalSessionContext.parse(result.json())).toMatchObject({
    employee_id: f.employeeId,
    user_id: f.userId,
  });
  const rawCookie = present(result.headers['set-cookie']);
  expect(rawCookie).toContain('pospay-personal.session_token=');
  expect(rawCookie).toContain('Path=/v1; HttpOnly; Secure; SameSite=Lax');
  expect(rawCookie).not.toContain('Domain=');
  cookie = String(rawCookie).split(';')[0] ?? '';
  expect((await verify(payload)).statusCode).toBe(401);
});

it('normal auth, admin, platform, kiosk and Device substitution reject personal credentials', async () => {
  expect(await f.auth.getSession(new Headers({ cookie }))).toBeNull();
  const substituted = cookie.replace('pospay-personal.session_token', 'pospay.session_token');
  expect(await f.auth.getSession(new Headers({ cookie: substituted }))).toBeNull();
  for (const url of [
    '/v1/me/workspaces',
    '/v1/businesses',
    '/v1/devices/me/staff-session',
    '/v1/auth/get-session',
  ]) {
    const result = await f.app.inject({ method: 'GET', url, headers: headers() });
    expect(result.statusCode).toBeGreaterThanOrEqual(400);
  }
  expect(
    (
      await f.app.inject({
        method: 'GET',
        url: '/v1/staff/passkey',
        headers: { ...headers(), authorization: 'Device synthetic' },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await f.app.inject({
        method: 'GET',
        url: '/v1/staff/passkey',
        headers: { ...headers(), origin: 'http://localhost:9999' },
      })
    ).statusCode,
  ).toBe(401);
  const kiosk = await f.auth.staff.issue(
    f.userId,
    {
      companyId: f.companyId,
      businessId: f.businessId,
      branchId: f.branchId,
      deviceId: f.ids.newId(),
    },
    async () => true,
  );
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/v1/staff/passkey/options',
        headers: { origin: personalOrigin, cookie: kiosk.cookie.split(';')[0] },
      })
    ).statusCode,
  ).toBe(401);
});

it('first enrollment binds automatically with audit/outbox and subsequent replacement is refused', async () => {
  expect(
    (await f.app.inject({ method: 'GET', url: '/v1/staff/passkey', headers: headers() })).json(),
  ).toMatchObject({ bound: false });
  const generated = await f.app.inject({
    method: 'POST',
    url: '/v1/staff/passkey/options',
    headers: headers(),
  });
  expect(generated.statusCode).toBe(200);
  passkeyRegistrationOptions.parse(generated.json());
  const device = testAuthenticator();
  const response = device.registration(
    generated.json().options.challenge,
    personalOrigin,
    'localhost',
  );
  const registered = await f.app.inject({
    method: 'POST',
    url: '/v1/staff/passkey/verify',
    headers: headers(),
    payload: { challenge_id: generated.json().challenge_id, response },
  });
  expect(registered.statusCode).toBe(201);
  const status = passkeyBindingStatus.parse(registered.json());
  expect(status).toMatchObject({ bound: true, revision: 1 });
  expect(
    await f.owner`SELECT id FROM audit_log WHERE entity='employee_passkey' AND entity_id=${status.binding_id}`,
  ).toHaveLength(1);
  const events =
    await f.owner`SELECT payload FROM outbox WHERE event_type='EmployeePasskeyBound' AND aggregate_id=${f.employeeId}`;
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events)).not.toContain(response.id);
  const again = await f.app.inject({
    method: 'POST',
    url: '/v1/staff/passkey/options',
    headers: headers(),
  });
  expect(again.statusCode).toBe(409);
  expect(again.json().code).toBe('PASSKEY_ALREADY_BOUND');
});

it('own schedule carries no employee selector, refuses extra selectors and unrelated branches', async () => {
  const read = (query: string) =>
    f.app.inject({
      method: 'GET',
      url: `/v1/staff/my-schedule?week_start=2026-10-03&${query}`,
      headers: headers(),
    });
  expect((await read(`branch_id=${f.branchId}`)).json()).toEqual({ schedule: null });
  expect((await read(`branch_id=${f.ids.newId()}`)).statusCode).toBe(404);
  expect((await read(`branch_id=${f.branchId}&employee_id=${f.ids.newId()}`)).statusCode).toBe(400);
});

it('FORCE RLS and partial unique prevent foreign reads/inserts/updates; status projection uses the active index', async () => {
  expect(
    await f.database.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`SELECT id FROM employee_passkeys`),
    ),
  ).toHaveLength(0);
  expect(
    await f.database.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`UPDATE employee_passkeys SET revision=revision+1 RETURNING id`),
    ),
  ).toHaveLength(0);
  const [binding] =
    await f.owner`SELECT passkey_id FROM employee_passkeys WHERE employee_id=${f.employeeId}`;
  await expect(
    f.database.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`INSERT INTO employee_passkeys(company_id,id,business_id,employee_id,passkey_id,revision,bound_at,bound_by)
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.employeeId},${binding?.['passkey_id']},1,clock_timestamp(),${f.userId})`),
    ),
  ).rejects.toThrow();
  const [table] =
    await f.owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='employee_passkeys'`;
  expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  const plan = await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${bindingStatusStatement(f.companyId, f.employeeId)}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('employee_passkeys_active_employee_key');
  expect(
    new PgDialect().sqlToQuery(bindingStatusStatement(f.companyId, f.employeeId)).sql,
  ).not.toContain('public_key');
});

it('concurrent enrollment creates one active binding; a losing global credential stays inert', async () => {
  const { userId, employeeId } = await seedEmployee('race');
  const raceScope = { ...scope(), userId, employeeId };
  const registration = new EnrolPasskey(
    f.auth.passkeys,
    createPasskeyTransactions(f.database, f.ids),
    f.ids,
    { now: () => new Date() },
    createAttendanceDeviceRefusals(f.database, f.ids, () => undefined),
  );
  const enrollments = await Promise.all(
    [0, 1].map(async () => {
      const generated = await f.auth.passkeys.enrollmentOptions(raceScope);
      const device = testAuthenticator();
      return {
        generated,
        response: device.registration(generated.options.challenge, personalOrigin, 'localhost'),
      };
    }),
  );
  const results = await Promise.allSettled(
    enrollments.map(({ generated, response }) =>
      registration.execute(raceScope, generated.challengeId, response),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    await f.owner`SELECT id FROM employee_passkeys WHERE employee_id=${employeeId} AND unbound_at IS NULL`,
  ).toHaveLength(1);
  expect(
    await f.owner`SELECT p.id FROM passkey p WHERE p.user_id=${userId} AND NOT EXISTS(SELECT 1 FROM employee_passkeys b WHERE b.passkey_id=p.id)`,
  ).toHaveLength(1);
});

it('employee relinking, ended membership and company closure revoke access on the next request', async () => {
  const session = () =>
    f.app.inject({ method: 'GET', url: '/v1/staff/personal-session', headers: headers() });
  await f.owner`UPDATE employees SET deleted_at=clock_timestamp() WHERE id=${f.employeeId}`;
  expect((await session()).statusCode).toBe(401);
  await f.owner`UPDATE employees SET deleted_at=NULL,user_id=NULL WHERE id=${f.employeeId}`;
  expect((await session()).statusCode).toBe(401);
  await f.owner`UPDATE employees SET user_id=${f.userId} WHERE id=${f.employeeId}`;
  await f.owner`UPDATE memberships SET ends_at=clock_timestamp() WHERE id=${f.membershipId}`;
  expect((await session()).statusCode).toBe(401);
  await f.owner`UPDATE memberships SET ends_at=NULL WHERE id=${f.membershipId}`;
  await f.owner`UPDATE companies SET deleted_at=clock_timestamp() WHERE id=${f.companyId}`;
  expect((await session()).statusCode).toBe(401);
  await f.owner`UPDATE companies SET deleted_at=NULL WHERE id=${f.companyId}`;
  expect((await session()).statusCode).toBe(200);
});

async function seedEmployee(label: string) {
  const userId = f.ids.newId(),
    employeeId = f.ids.newId();
  await f.owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'Synthetic race',${label + '@example.test'})`;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.companyId},${employeeId},${f.businessId},${f.branchId},${userId},'Synthetic race',${employeeNameMatchKey('Synthetic race')},'staff','2026-01-01')`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${f.companyId},${f.ids.newId()},${userId},id,'global','BRANCH',${f.branchId} FROM roles WHERE code='staff' AND company_id IS NULL`;
  return { userId, employeeId };
}

it('a rolled-back tenant binding leaves a global credential inert without audit or outbox', async () => {
  const { userId, employeeId } = await seedEmployee('rollback');
  const requestScope = { ...scope(), userId, employeeId };
  const transactions = createPasskeyTransactions(
    {
      ...f.database,
      withTenant: (company, work, options) =>
        f.database.withTenant(
          company,
          async (tx) => {
            await work(tx);
            throw new Error('SYNTHETIC_ROLLBACK');
          },
          options,
        ),
    },
    f.ids,
  );
  const registration = new EnrolPasskey(
    f.auth.passkeys,
    transactions,
    f.ids,
    {
      now: () => new Date(),
    },
    createAttendanceDeviceRefusals(f.database, f.ids, () => undefined),
  );
  const generated = await f.auth.passkeys.enrollmentOptions(requestScope);
  const device = testAuthenticator();
  await expect(
    registration.execute(
      requestScope,
      generated.challengeId,
      device.registration(generated.options.challenge, personalOrigin, 'localhost'),
    ),
  ).rejects.toThrow('PASSKEY_BINDING_PERSISTENCE_FAILED');
  expect(await f.owner`SELECT id FROM passkey WHERE user_id=${userId}`).toHaveLength(1);
  expect(
    await f.owner`SELECT id FROM employee_passkeys WHERE employee_id=${employeeId}`,
  ).toHaveLength(0);
  expect(await f.owner`SELECT id FROM outbox WHERE aggregate_id=${employeeId}`).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM audit_log WHERE after->>'employee_id'=${employeeId}`,
  ).toHaveLength(0);
});
