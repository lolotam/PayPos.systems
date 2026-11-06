import { OWN_WORK_READS, type OwnWorkReads } from '../queries/own-work-context.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tipFixture, must, type TipFixture } from '../../../../test/session-tips.fixture.ts';
import { paired, origin, phone } from '../../../../test/staff-otp-harness.ts';
const personalOrigin = 'http://localhost:5173';
let instant = new Date(Math.floor(Date.now() / 1000) * 1000);
let f: TipFixture;
let device: Awaited<ReturnType<typeof paired>>;
let staffCookie: string;
let personalCookie: string;
let capturedLogs = '';
const headers = () => ({ cookie: staffCookie, authorization: `Device ${device.token}`, origin });
const read = (window?: string) =>
  f.h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/service-lines',
    headers: { ...headers(), ...(window ? { 'x-private-view-window-id': window } : {}) },
  });
const open = async () => {
  const response = await f.h.app.inject({
    method: 'POST',
    url: '/v1/staff/me/private-view',
    headers: headers(),
    payload: { pin: '1234' },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ window_id: string }>().window_id;
};
beforeAll(async () => {
  f = await tipFixture({
    personalOrigin,
    staffOrigin: origin,
    clock: { now: () => instant },
    ordersClock: { now: () => instant },
    logs: {
      write: (chunk: string) => {
        capturedLogs += chunk;
      },
    },
  });
  await f.linkEmployee(must(f.employees[0]), f.userId);
  await f.h
    .owner`UPDATE memberships SET role_id=(SELECT id FROM roles WHERE code='staff' AND company_id IS NULL),role_owner_key='global',starts_at='2026-01-01' WHERE company_id=${f.company} AND id=${f.membership}`;
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
it('personal reads need no window, return no-store, and reject client subjects', async () => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/service-lines',
    headers: { cookie: personalCookie, origin: personalOrigin },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toMatchObject({ items: [] });
  const refused = await f.h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/service-lines?employee_id=foreign',
    headers: { cookie: personalCookie, origin: personalOrigin },
  });
  expect(refused.statusCode).toBe(403);
});
it('STAFF_POS needs a window, expires at idle 61 seconds and at the five-minute cap, and dead sessions are 401', async () => {
  expect((await read()).statusCode).toBe(403);
  const idle = await open();
  const response = await read(idle);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  instant = new Date(instant.getTime() + 61000);
  expect((await read(idle)).json().code).toBe('PRIVATE_VIEW_EXPIRED');
  const capped = await open();
  for (let i = 0; i < 6; i++) {
    instant = new Date(instant.getTime() + 50000);
    expect((await read(capped)).statusCode).toBe(200);
  }
  instant = new Date(instant.getTime() + 1000);
  expect((await read(capped)).json().code).toBe('PRIVATE_VIEW_EXPIRED');
  const live = await open();
  await f.h.auth.staff.issue(
    f.userId,
    { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: device.id },
    async () => true,
  );
  const dead = await read(live);
  expect(dead.statusCode).toBe(401);
  expect(dead.json().code).toBe('UNAUTHENTICATED');
});

it.each(['unlink', 'membership', 'contract', 'attachment'])(
  'refuses %s committed after the personal guard and before live query checks',
  async (change) => {
    const positive = await f.h.app.inject({
      method: 'GET',
      url: '/v1/staff/me/service-lines',
      headers: { cookie: personalCookie, origin: personalOrigin },
    });
    expect(positive.statusCode).toBe(200);
    const reads = f.h.app.get<OwnWorkReads>(OWN_WORK_READS);
    const original = reads.context;
    reads.context = async (tx, context, now) => {
      if (change === 'unlink')
        await f.h
          .owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND user_id=${f.userId}`;
      else if (change === 'membership')
        await f.h
          .owner`UPDATE memberships SET ends_at=clock_timestamp()-interval '1 second' WHERE company_id=${f.company} AND id=${f.membership}`;
      else if (change === 'contract')
        await f.h
          .owner`UPDATE employees SET contract_end=${new Date(instant.getTime() - 86400000).toISOString().slice(0, 10)}
          WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
      else
        await f.h.owner`UPDATE employee_branches SET "to"=${instant.toISOString().slice(0, 10)}
          WHERE company_id=${f.company} AND employee_id=${must(f.employees[0])} AND "to" IS NULL`;
      return original(tx, context, now);
    };
    try {
      const response = await f.h.app.inject({
        method: 'GET',
        url: '/v1/staff/me/service-lines?month=bad',
        headers: { cookie: personalCookie, origin: personalOrigin },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
      expect(response.json()).not.toHaveProperty('items');
    } finally {
      reads.context = original;
      await f.h
        .owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
      await f.h
        .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
      await f.h
        .owner`UPDATE employees SET contract_end=NULL WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
      if (change === 'attachment')
        await f.h
          .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
          VALUES(${f.company},gen_random_uuid(),${f.business},${must(f.employees[0])},${f.branch},${instant.toISOString().slice(0, 10)})`;
    }
  },
);
it('a live own DENY refuses the staff holder and returns no private fields', async () => {
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},gen_random_uuid(),${f.membership},'read:service-sessions:own','DENY','BRANCH',${f.branch},'Synthetic own denial',${f.userId})`;
  try {
    const response = await f.h.app.inject({
      method: 'GET',
      url: '/v1/staff/me/service-lines',
      headers: { cookie: personalCookie, origin: personalOrigin },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json()).not.toHaveProperty('items');
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership} AND permission_code='read:service-sessions:own'`;
  }
});

it.each(['service-lines', 'tips'])(
  'protects %s against session-less/admin access and client scope keys',
  async (route) => {
    for (const cookie of [undefined, f.ownerCookie]) {
      const response = await f.h.app.inject({
        method: 'GET',
        url: `/v1/staff/me/${route}`,
        headers: { origin: personalOrigin, ...(cookie ? { cookie } : {}) },
      });
      expect([401, 403]).toContain(response.statusCode);
      expect(response.headers['cache-control']).toBe('no-store');
    }
    for (const key of ['employee_id', 'branch_id', 'business_id', 'company_id']) {
      const response = await f.h.app.inject({
        method: 'GET',
        url: `/v1/staff/me/${route}?${key}=foreign`,
        headers: { cookie: personalCookie, origin: personalOrigin },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
      expect(response.headers['cache-control']).toBe('no-store');
    }
  },
);

it('returns visible own tips through the personal route without a private-view window', async () => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/tips',
    headers: { cookie: personalCookie, origin: personalOrigin },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json()).toMatchObject({
    status: 'VISIBLE',
    total_cash: '0.000',
    total_card: '0.000',
  });
  expect(response.body).not.toMatch(/phone|comment|employee_id|customer_id/);
  expect(capturedLogs).not.toContain(phone);
  expect(capturedLogs).not.toContain('+999999998123');
});
