import { errorEnvelope, staffColumnsSettings } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { deviceToken, foreignBusinessId } from './set-business-logo.support.ts';

import { readStaffColumns } from '../index.ts';

// The four consumer adapters are proven in their own modules (staff-columns.adapter.spec.ts); here the public
// reader they all call stands for them.
const ADAPTERS = {
  reader: {
    allowed: async (tx: Tx, company: string, business: string) =>
      new Set((await readStaffColumns(tx, company, business)).columns),
    monthsBack: async (tx: Tx, company: string, business: string) =>
      (await readStaffColumns(tx, company, business)).monthsBack,
  },
};
const DEFAULT = [
  'date',
  'time',
  'service',
  'customer_name',
  'share',
  'estimated_commission',
  'tip',
];
const URL = (business: string) => `/v1/businesses/${business}/settings/staff-columns`;

let f: PermissionFixture;
let keys = 0;
beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

type Headers = Record<string, string>;
const owner = (company = f.company): Headers => ({ cookie: f.cookie, 'x-company-id': company });
const put = (
  body: object,
  headers: Headers = owner(),
  business = f.business,
  key = `staff-columns-${++keys}`,
) =>
  f.h.app.inject({
    method: 'PUT',
    url: URL(business),
    headers: { ...headers, 'idempotency-key': key },
    payload: body,
  });
const get = (headers: Headers = owner(), business = f.business) =>
  f.h.app.inject({ method: 'GET', url: URL(business), headers });
const throughAdapters = () =>
  f.db.withTenant(f.company, async (tx) => {
    const seen: Record<string, { columns: string[]; monthsBack: number }> = {};
    for (const [name, port] of Object.entries(ADAPTERS)) {
      seen[name] = {
        columns: [...(await port.allowed(tx, f.company, f.business))],
        monthsBack: await port.monthsBack(tx, f.company, f.business),
      };
    }
    return seen;
  });
const everyAdapter = (columns: string[], monthsBack: number) =>
  Object.fromEntries(Object.keys(ADAPTERS).map((name) => [name, { columns, monthsBack }]));
const audits = () => f.h.owner`SELECT action, before, after, actor_user_id FROM audit_log
  WHERE company_id = ${f.company} AND entity = 'business_settings' AND entity_id = ${f.business}
    AND action LIKE 'settings.staff_%' ORDER BY id`;
const stored = async () => {
  const [row] = await f.h.owner`SELECT staff_columns, staff_months_back FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  return row ?? { staff_columns: null, staff_months_back: null };
};

it('MY-17 nothing saved: every adapter gets the MY-Q3 default and one month, rating_average hidden', async () => {
  expect(await throughAdapters()).toEqual(everyAdapter(DEFAULT, 1));
  const read = await get();
  expect(read.statusCode).toBe(200);
  expect(staffColumnsSettings.parse(read.json())).toEqual({
    business_id: f.business,
    columns: DEFAULT,
    columns_default: true,
    months_back: 1,
    months_back_default: true,
  });
});

it('MY-18/MY-20 a saved set reaches every adapter, the estimate can be hidden, and each change is audited once', async () => {
  const saved = await put({ columns: ['date', 'service', 'list_price'], months_back: null });
  expect(saved.statusCode).toBe(200);
  expect(staffColumnsSettings.parse(saved.json())).toMatchObject({
    columns: ['date', 'service', 'list_price'],
    columns_default: false,
    months_back: 1,
    months_back_default: true,
  });
  expect(await throughAdapters()).toEqual(everyAdapter(['date', 'service', 'list_price'], 1));
  expect(await audits()).toEqual([
    {
      action: 'settings.staff_columns_changed',
      before: { staff_columns: null },
      after: { staff_columns: ['date', 'service', 'list_price'] },
      actor_user_id: f.userId,
    },
  ]);
  const replayBody = { columns: ['date', 'tip'], months_back: null };
  const replay = await put(replayBody, owner(), f.business, 'staff-columns-replay');
  const again = await put(replayBody, owner(), f.business, 'staff-columns-replay');
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual(replay.json());
  expect(await audits()).toHaveLength(2);
  expect(
    (await put({ columns: ['date', 'service', 'list_price'], months_back: null })).statusCode,
  ).toBe(200);
});

it('MY-13 months back: saved 3 and 24 reach every adapter; 0 and 25 are 422 and the CHECK refuses them', async () => {
  expect((await put({ columns: null, months_back: 3 })).statusCode).toBe(200);
  expect(await throughAdapters()).toEqual(everyAdapter(DEFAULT, 3));
  expect((await put({ columns: null, months_back: 24 })).statusCode).toBe(200);
  expect(await throughAdapters()).toEqual(everyAdapter(DEFAULT, 24));
  const before = await audits();
  for (const months_back of [0, 25, 1001, -5000]) {
    const refused = await put({ columns: null, months_back });
    expect(refused.statusCode).toBe(422);
    expect(errorEnvelope.parse(refused.json()).code).toBe('STAFF_MONTHS_BACK_INVALID');
  }
  expect(await audits()).toEqual(before);
  for (const months of [0, 25]) {
    await expect(
      f.h.owner`UPDATE business_settings SET staff_months_back = ${months}
        WHERE company_id = ${f.company} AND business_id = ${f.business}`,
    ).rejects.toThrow(/business_settings_staff_months_back/);
  }
  const months = (await audits()).filter(
    (row) => row['action'] === 'settings.staff_months_back_changed',
  );
  expect(months.map((row) => [row['before'], row['after']])).toEqual([
    [{ staff_months_back: null }, { staff_months_back: 3 }],
    [{ staff_months_back: 3 }, { staff_months_back: 24 }],
  ]);
  expect((await put({ columns: null, months_back: null })).statusCode).toBe(200);
  expect(await throughAdapters()).toEqual(everyAdapter(DEFAULT, 1));
});

it('MY-19 an unknown, duplicate, rating_comments, customer_phone or rating_average code is 422 and nothing is saved', async () => {
  const before = { row: await stored(), audits: await audits() };
  for (const columns of [
    ['date', 'bogus'],
    ['date', 'date'],
    ['date', 'rating_comments'],
    ['customer_phone'],
    ['rating_average'],
    ['x'.repeat(100)],
  ]) {
    const refused = await put({ columns, months_back: 5 });
    expect(refused.statusCode).toBe(422);
    const envelope = errorEnvelope.parse(refused.json());
    expect(envelope.code).toBe('STAFF_COLUMNS_INVALID');
    expect(envelope.details).toEqual({ codes: [columns.at(-1)] });
  }
  expect({ row: await stored(), audits: await audits() }).toEqual(before);
  for (const value of ['{date,date}', '{bogus}', '{rating_comments}']) {
    await expect(
      f.h.owner`UPDATE business_settings SET staff_columns = ${value}::text[]
        WHERE company_id = ${f.company} AND business_id = ${f.business}`,
    ).rejects.toThrow(/business_settings_staff_columns/);
  }
});

it('MY-21 no permission, a device or another business is a uniform 403 and nothing is saved', async () => {
  const before = { row: await stored(), audits: await audits() };
  const manager = { cookie: f.managerCookie, 'x-company-id': f.company };
  const refusals = [
    await put({ columns: ['date'], months_back: 2 }, manager),
    await get(manager),
    await put({ columns: ['date'], months_back: 2 }, owner(f.otherCompany)),
    await put({ columns: ['date'], months_back: 2 }, owner(), await foreignBusinessId(f)),
  ];
  const token = await deviceToken(f);
  refusals.push(
    await put(
      { columns: ['date'], months_back: 2 },
      {
        authorization: `Device ${token}`,
        'x-company-id': f.company,
      },
    ),
  );
  const bodies = refusals.map((res) => [res.statusCode, errorEnvelope.parse(res.json()).code]);
  expect(bodies).toEqual(refusals.map(() => [403, 'FORBIDDEN']));
  await seedOverride(f, f.managerMember, { permission_code: 'read:settings:business' });
  expect((await get(manager)).statusCode).toBe(200);
  expect((await put({ columns: ['date'], months_back: 2 }, manager)).statusCode).toBe(403);
  expect({ row: await stored(), audits: await audits() }).toEqual(before);
  await seedOverride(f, f.managerMember, { permission_code: 'manage:settings:business' });
  expect((await put({ columns: ['date'], months_back: 2 }, manager)).statusCode).toBe(200);
  expect(await throughAdapters()).toEqual(everyAdapter(['date'], 2));
});
