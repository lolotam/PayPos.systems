import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  employeesFixture,
  termsFor,
  grantEmployeeCreation,
  type EmployeeFixture,
} from './employees.fixture.ts';
import { paired, origin, phone } from '../../../../test/staff-otp-harness.ts';
const personalOrigin = 'http://localhost:5173';
const instant = new Date('2026-11-06T10:00:00.000Z');
let f: EmployeeFixture;
let device: Awaited<ReturnType<typeof paired>>;
let staffCookie: string;
let personalCookie: string;
const headers = () => ({ cookie: staffCookie, authorization: `Device ${device.token}`, origin });
beforeAll(async () => {
  f = await employeesFixture({
    personalOrigin,
    staffOrigin: origin,
    clock: { now: () => instant },
  });
  await grantEmployeeCreation(f);
  await f.useCase.execute({
    companyId: f.company,
    businessId: f.business,
    userId: f.userId,
    input: { ...termsFor(f), user_id: f.userId },
  });
  await f.h
    .owner`UPDATE memberships SET role_id=(SELECT id FROM roles WHERE code='staff' AND company_id IS NULL),role_owner_key='global',starts_at='2026-01-01' WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${f.userId}`;
  await f.h
    .owner`UPDATE "user" SET phone_binding_approved_at=${new Date(instant.getTime() - 60000).toISOString()} WHERE id=${f.userId}`;
  device = await paired(f.h, f.ownerCookie, f.company, f.branch);
  const reset = await f.h.send('POST', '/v1/staff-pins/reset', {
    cookie: f.ownerCookie,
    company: f.company,
    body: { user_id: f.userId, pin: '1234' },
  });
  expect(reset.status).toBe(204);
  const context = {
    companyId: f.company,
    businessId: f.business,
    branchId: f.branch,
    deviceId: device.id,
  };
  staffCookie =
    (await f.h.auth.staff.issue(f.userId, context, async () => true)).cookie.split(';')[0] ?? '';
  personalCookie =
    (
      await f.h.auth.personal.issue(
        f.userId,
        { purpose: 'STAFF_PERSONAL', companyId: f.company, businessId: f.business },
        async () => true,
      )
    ).cookie.split(';')[0] ?? '';
  expect(await f.h.auth.personal.resolve(new Headers({ cookie: personalCookie }))).not.toBeNull();
  expect(
    await f.h.auth.staff.resolve(new Headers({ cookie: staffCookie }), context),
  ).not.toBeNull();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('personal branch discovery needs no private window and rejects client selectors', async () => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/branches',
    headers: { cookie: personalCookie, origin: personalOrigin },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json().items).toHaveLength(1);
  expect(Object.keys(response.json().items[0]).sort()).toEqual([
    'id',
    'name_ar',
    'name_en',
    'timezone',
  ]);
  for (const selector of ['employee_id', 'branch_id', 'business_id', 'company_id']) {
    const rejected = await f.h.app.inject({
      method: 'GET',
      url: `/v1/staff/me/branches?${selector}=foreign`,
      headers: { cookie: personalCookie, origin: personalOrigin },
    });
    expect(rejected.statusCode).toBe(403);
  }
});
it('refuses admin, kiosk, device and missing credentials without fallback', async () => {
  for (const requestHeaders of [
    {},
    { cookie: f.ownerCookie },
    headers(),
    { authorization: `Device ${device.token}`, origin },
    { cookie: staffCookie, origin: personalOrigin },
  ]) {
    const response = await f.h.app.inject({
      method: 'GET',
      url: '/v1/staff/me/branches',
      headers: requestHeaders,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).not.toHaveProperty('items');
  }
});
