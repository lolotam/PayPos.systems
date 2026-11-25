import { afterAll, beforeAll, expect, it } from 'vitest';

import { insertCommissionLineProjection } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { ids, must, tipFixture, type TipFixture } from '../../../../test/session-tips.fixture.ts';
import { origin, paired, phone } from '../../../../test/staff-otp-harness.ts';

const personalOrigin = 'http://localhost:5173';
const URL = '/v1/staff/me/commission-estimate';
let instant = new Date(Math.floor(Date.now() / 1000) * 1000);
let f: TipFixture;
let device: Awaited<ReturnType<typeof paired>>;
let staffCookie: string;
let personalCookie: string;
let capturedLogs = '';
let month = '';

const kuwaitMonth = (at: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}`;
};
const staffHeaders = () => ({
  cookie: staffCookie,
  authorization: `Device ${device.token}`,
  origin,
});
const personal = (url = URL) =>
  f.h.app.inject({
    method: 'GET',
    url,
    headers: { cookie: personalCookie, origin: personalOrigin },
  });
const staff = async (window?: string) => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: URL,
    headers: { ...staffHeaders(), ...(window ? { 'x-private-view-window-id': window } : {}) },
  });
  expect(response.headers['cache-control']).toBe('no-store');
  return response;
};
const open = async () => {
  const response = await f.h.app.inject({
    method: 'POST',
    url: '/v1/staff/me/private-view',
    headers: staffHeaders(),
    payload: { pin: '1234' },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ window_id: string }>().window_id;
};
const setColumns = (columns: string[], monthsBack: number | null) =>
  f.h.owner`INSERT INTO business_settings (company_id, business_id, staff_columns, staff_months_back)
    VALUES (${f.company}, ${f.business}, ${columns}, ${monthsBack})
    ON CONFLICT (company_id, business_id)
    DO UPDATE SET staff_columns = EXCLUDED.staff_columns, staff_months_back = EXCLUDED.staff_months_back`;

async function seedMonthLines() {
  await f.db.withTenant(f.company, async (tx) => {
    const tenant = {
      company: f.company,
      business: f.business,
      branch: f.branch,
      employee: must(f.employees[0]),
      membership: f.membership,
      service: must(f.services[1]),
      customer: f.customer,
    };
    const row = { period: month, businessDate: `${month}-01`, ruleKind: 'PCT', rulePctBps: 1000 };
    await insertCommissionLineProjection(tx, tenant, ids, { ...row, net: '10.000' });
    await insertCommissionLineProjection(tx, { ...tenant, employee: must(f.employees[1]) }, ids, {
      ...row,
      net: '30.000',
    });
  });
}

async function issueSessions() {
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
}

beforeAll(async () => {
  month = kuwaitMonth(instant);
  f = await tipFixture({
    personalOrigin,
    staffOrigin: origin,
    clock: { now: () => instant },
    ordersClock: { now: () => instant },
    commissionsClock: { now: () => instant },
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
  await setColumns(['date', 'estimated_commission', 'tip'], null);
  await seedMonthLines();
  await issueSessions();
});

afterAll(async () => {
  await f?.close();
});

it('MY-09 personal reads need no window, price only the own lines and never leak a colleague or the customer', async () => {
  const response = await personal();
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const body = response.json();
  expect(body).toMatchObject({ status: 'ESTIMATE', total: '1.000', recalculated: false });
  expect(body.per_line).toHaveLength(1);
  expect(response.body).not.toMatch(/phone|customer|employee_id|Synthetic customer/);
  expect(response.body).not.toContain('3.000');
  expect(capturedLogs).not.toContain(phone);
  expect(capturedLogs).not.toContain('Synthetic customer');
});

it('MY-10 to MY-12 STAFF_POS needs a window, expires at idle 61 seconds and at the five-minute cap, and dead sessions are 401', async () => {
  expect((await staff()).statusCode).toBe(403);
  const idle = await open();
  expect((await staff(idle)).statusCode).toBe(200);
  instant = new Date(instant.getTime() + 61000);
  expect((await staff(idle)).json().code).toBe('PRIVATE_VIEW_EXPIRED');
  const capped = await open();
  for (let i = 0; i < 6; i++) {
    instant = new Date(instant.getTime() + 50000);
    expect((await staff(capped)).statusCode).toBe(200);
  }
  instant = new Date(instant.getTime() + 1000);
  expect((await staff(capped)).json().code).toBe('PRIVATE_VIEW_EXPIRED');
  const live = await open();
  await f.h.auth.staff.issue(
    f.userId,
    { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: device.id },
    async () => true,
  );
  const dead = await staff(live);
  expect(dead.statusCode).toBe(401);
  expect(dead.json().code).toBe('UNAUTHENTICATED');
});

it('MY-13 the default window is two months and an older month is 422', async () => {
  const refused = await personal(`${URL}?month=2020-01`);
  expect(refused.statusCode).toBe(422);
  expect(refused.json().code).toBe('MY_PERIOD_OUT_OF_RANGE');
  expect(refused.headers['cache-control']).toBe('no-store');
  const bad = await personal(`${URL}?month=bad`);
  expect(bad.statusCode).toBe(400);
});

it('MY-20 a hidden column answers only the status', async () => {
  await setColumns(['date', 'tip'], null);
  try {
    const response = await personal();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'HIDDEN' });
  } finally {
    await setColumns(['date', 'estimated_commission', 'tip'], null);
  }
});

// المسار يقرأ من لقطة REPEATABLE READ فالتغيير بعد أول جملة ما بيبانش؛ فبنثبّت التغيير قبل الطلب.
it.each(['unlink', 'membership', 'contract', 'attachment', 'feature'])(
  'MY-13b refuses %s on the live recheck and returns no private field',
  async (change) => {
    expect((await personal()).statusCode).toBe(200);
    const employee = must(f.employees[0]);
    if (change === 'unlink')
      await f.h
        .owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND user_id=${f.userId}`;
    else if (change === 'membership')
      await f.h
        .owner`UPDATE memberships SET ends_at=clock_timestamp()-interval '1 second' WHERE company_id=${f.company} AND id=${f.membership}`;
    else if (change === 'contract')
      await f.h
        .owner`UPDATE employees SET contract_end=${new Date(instant.getTime() - 86400000).toISOString().slice(0, 10)}
        WHERE company_id=${f.company} AND id=${employee}`;
    else if (change === 'feature')
      await f.h
        .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'commissions',false,'Synthetic feature refusal',${f.ownerId})`;
    else
      await f.h.owner`UPDATE employee_branches SET "to"=${instant.toISOString().slice(0, 10)}
        WHERE company_id=${f.company} AND employee_id=${employee} AND "to" IS NULL`;
    try {
      const response = await personal();
      expect([401, 403]).toContain(response.statusCode);
      expect(response.json()).not.toHaveProperty('total');
      expect(response.json()).not.toHaveProperty('per_line');
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      if (change === 'feature')
        await f.h
          .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='commissions'`;
      await f.h
        .owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${employee}`;
      await f.h
        .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
      await f.h
        .owner`UPDATE employees SET contract_end=NULL WHERE company_id=${f.company} AND id=${employee}`;
      if (change === 'attachment')
        await f.h
          .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
          VALUES(${f.company},gen_random_uuid(),${f.business},${employee},${f.branch},${instant.toISOString().slice(0, 10)})`;
    }
    expect((await personal()).statusCode).toBe(200);
  },
);

it('a live own DENY on read:commissions:own refuses the staff holder with no private field', async () => {
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},gen_random_uuid(),${f.membership},'read:commissions:own','DENY','BRANCH',${f.branch},'Synthetic own denial',${f.userId})`;
  try {
    const response = await personal();
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json()).not.toHaveProperty('total');
    expect(response.headers['cache-control']).toBe('no-store');
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership} AND permission_code='read:commissions:own'`;
  }
});

it('protects the route against session-less and admin access and against client subject keys', async () => {
  for (const cookie of [undefined, f.ownerCookie]) {
    const response = await f.h.app.inject({
      method: 'GET',
      url: URL,
      headers: { origin: personalOrigin, ...(cookie ? { cookie } : {}) },
    });
    expect([401, 403]).toContain(response.statusCode);
    expect(response.headers['cache-control']).toBe('no-store');
  }
  for (const key of ['employee_id', 'branch_id', 'business_id', 'company_id']) {
    const response = await personal(`${URL}?${key}=foreign`);
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.headers['cache-control']).toBe('no-store');
  }
});
