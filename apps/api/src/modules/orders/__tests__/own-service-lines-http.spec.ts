import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  ids,
  must,
  recordVisitAt,
  tipFixture,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';
import { paired, origin, phone } from '../../../../test/staff-otp-harness.ts';

const personalOrigin = 'http://localhost:5173';
let instant = new Date(Math.floor(Date.now() / 1000) * 1000);
let f: TipFixture;
let device: Awaited<ReturnType<typeof paired>>;
let staffCookie: string;
let personalCookie: string;
let capturedLogs = '';
const own: string[] = [];
let colleague: string[] = [];
const URL = '/v1/staff/me/service-lines';

const personal = (query = '', cookie = personalCookie) =>
  f.h.app.inject({
    method: 'GET',
    url: `${URL}${query}`,
    headers: { cookie, origin: personalOrigin },
  });
const staffHeaders = () => ({
  cookie: staffCookie,
  authorization: `Device ${device.token}`,
  origin,
});
const kiosk = async (window?: string) => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: URL,
    headers: { ...staffHeaders(), ...(window ? { 'x-private-view-window-id': window } : {}) },
  });
  expect(response.headers['cache-control']).toBe('no-store');
  return response;
};
const openWindow = async () => {
  const response = await f.h.app.inject({
    method: 'POST',
    url: '/v1/staff/me/private-view',
    headers: staffHeaders(),
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
  f.setAt(instant);
  const at = instant.toISOString();
  for (let n = 0; n < 3; n++) own.push(...(await recordVisitAt(f, at, [f.line()])).lineIds);
  colleague = (
    await recordVisitAt(f, at, [
      { ...f.line(), performers: [{ employee_id: must(f.employees[1]) }] },
    ])
  ).lineIds;
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
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('a personal session gets only her own lines, newest first, no-store, with a walkable cursor', async () => {
  const response = await personal('?limit=100');
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const body = response.json<{
    items: { line_id: string }[];
    next_cursor: string | null;
    time_zone: string;
  }>();
  expect(body.time_zone).toBe('Asia/Kuwait');
  const returned = body.items.map((line) => line.line_id);
  expect([...returned].sort()).toEqual([...own].sort());
  expect(returned).not.toContain(must(colleague[0]));
  expect(response.body).not.toMatch(/phone|employee_id|customer_id|recorded_by|rating|comment/);
  const first = (await personal('?limit=2')).json<{
    items: { line_id: string }[];
    next_cursor: string;
  }>();
  expect(first.items).toHaveLength(2);
  const second = (await personal(`?limit=2&cursor=${first.next_cursor}`)).json<{
    items: { line_id: string }[];
    next_cursor: null;
  }>();
  expect([...first.items, ...second.items].map((l) => l.line_id)).toEqual(returned);
  expect(second.next_cursor).toBeNull();
});

it('refuses an unknown, a colleague and a malformed cursor with one uniform 400', async () => {
  const bodies: string[] = [];
  for (const cursor of [ids.newId(), must(colleague[0]), 'not-a-uuid']) {
    const response = await personal(`?cursor=${cursor}`);
    expect(response.statusCode).toBe(400);
    expect(response.headers['cache-control']).toBe('no-store');
    bodies.push(response.body);
  }
  expect(new Set(bodies).size).toBe(1);
  for (const query of ['?limit=0', '?limit=101', '?month=bad', '?month=2025-01&limit=x']) {
    const response = await personal(query);
    expect([400, 422]).toContain(response.statusCode);
    expect(response.headers['cache-control']).toBe('no-store');
  }
  expect((await personal('?month=2020-01')).statusCode).toBe(422);
});

it('STAFF_POS needs a live private-view window, expires at idle 61 s, and a dead operator is 401', async () => {
  expect((await kiosk()).statusCode).toBe(403);
  const idle = await openWindow();
  const ok = await kiosk(idle);
  expect(ok.statusCode).toBe(200);
  expect(ok.json<{ items: unknown[] }>().items).toHaveLength(own.length);
  expect(ok.json<{ time_zone: string }>().time_zone).toBe('Asia/Kuwait');
  instant = new Date(instant.getTime() + 61000);
  expect((await kiosk(idle)).json().code).toBe('PRIVATE_VIEW_EXPIRED');
  const live = await openWindow();
  await f.h.auth.staff.issue(
    f.userId,
    { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: device.id },
    async () => true,
  );
  const dead = await kiosk(live);
  expect(dead.statusCode).toBe(401);
  expect(dead.json().code).toBe('UNAUTHENTICATED');
});

it('rejects client scope keys, session-less and admin access, always no-store', async () => {
  for (const key of ['employee_id', 'branch_id', 'business_id', 'company_id']) {
    const response = await personal(`?${key}=foreign`);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.headers['cache-control']).toBe('no-store');
  }
  for (const cookie of [undefined, f.ownerCookie]) {
    const response = await f.h.app.inject({
      method: 'GET',
      url: URL,
      headers: { origin: personalOrigin, ...(cookie ? { cookie } : {}) },
    });
    expect([401, 403]).toContain(response.statusCode);
    expect(response.headers['cache-control']).toBe('no-store');
  }
});

it('a live own DENY or an unlinked employee refuses and returns no private field', async () => {
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},gen_random_uuid(),${f.membership},'read:service-sessions:own','DENY','BRANCH',${f.branch},'Synthetic own denial',${f.userId})`;
  try {
    const denied = await personal();
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).not.toHaveProperty('items');
    expect(denied.headers['cache-control']).toBe('no-store');
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership} AND permission_code='read:service-sessions:own'`;
  }
  await f.linkEmployee(must(f.employees[0]), null);
  try {
    const unlinked = await personal('?month=bad');
    expect([401, 403]).toContain(unlinked.statusCode);
    expect(unlinked.body).not.toContain('items');
  } finally {
    await f.linkEmployee(must(f.employees[0]), f.userId);
  }
  expect((await personal()).statusCode).toBe(200);
});

it('keeps phones, customer names and line details out of the request logs', async () => {
  expect((await personal()).statusCode).toBe(200);
  for (const secret of [phone, '+999999998123', 'Synthetic customer', '25.000'])
    expect(capturedLogs).not.toContain(secret);
});
