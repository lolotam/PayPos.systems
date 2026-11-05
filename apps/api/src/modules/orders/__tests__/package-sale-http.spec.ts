import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { ids, must } from './session.fixture.ts';
import { packageSaleFixture, type PackageSaleFixture } from './package-sale.fixture.ts';

let f: PackageSaleFixture;
beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  await f?.close();
});

const url = (branch = f.branch, business = f.business) =>
  `/v1/businesses/${business}/branches/${branch}/package-sales`;
const post = (
  body: object,
  options: {
    key?: string;
    cookie?: string;
    company?: string;
    branch?: string;
    business?: string;
  } = {},
) =>
  f.h.send('POST', url(options.branch ?? f.branch, options.business ?? f.business), {
    cookie: options.cookie ?? f.cookie,
    company: options.company ?? f.company,
    key: options.key ?? ids.newId(),
    body,
  });
const entitlements = () =>
  f.h.owner`SELECT id,price_paid,discount,discount_bps FROM package_entitlements WHERE company_id=${f.company}`;
const outbox = () => f.h.owner`SELECT aggregate_id FROM outbox WHERE event_type='PackageSaleChanged'`;

it('sells one package in one transaction: the entitlement, its components, its sessions, the audit row and the event', async () => {
  const before = await entitlements();
  const response = await post(f.saleInput());
  expect(response.status).toBe(201);
  const entitlement = response.body['entitlement'] as Record<string, unknown>;
  expect(entitlement).toMatchObject({
    business_id: f.business,
    customer_id: f.customer,
    package_type_id: f.packageType,
    sold_branch_id: f.branch,
    name_en: 'Synthetic sale package',
    list_price: '30.000',
    price_paid: '30.000',
    discount: '0.000',
    discount_bps: 0,
    paid_method: 'CASH',
    seller_employee_id: must(f.employees[0]),
    late: false,
    refunded_amount: '0.000',
    revision: 1,
  });
  expect(entitlement['sold_at']).toBe('2026-10-15T08:00:00.000Z');
  expect(entitlement['sold_business_date']).toBe('2026-10-15');
  expect(entitlement['expires_on']).toBe('2027-01-13');
  const components = entitlement['components'] as {
    service_id: string;
    component_value: string;
    sessions_total: number;
  }[];
  expect(components.map((component) => component.service_id)).toEqual([f.firstService, f.secondService]);
  expect(components.map((component) => component.component_value)).toEqual(['26.258', '3.742']);
  expect(components.map((component) => component.sessions_total)).toEqual([4, 2]);

  const saleId = entitlement['id'] as string;
  const rows = await entitlements();
  expect(rows).toHaveLength(before.length + 1);
  expect(rows[0]).toMatchObject({ id: saleId, price_paid: '30.000', discount: '0.000', discount_bps: 0 });
  const slots = await f.h.owner`SELECT unit_value,state,ordinal FROM package_session_slots WHERE entitlement_id=${saleId} ORDER BY component_id,ordinal`;
  expect(slots.map((slot) => slot['unit_value'])).toEqual(['6.564', '6.564', '6.564', '6.566', '1.871', '1.871']);
  expect(slots.every((slot) => slot['state'] === 'FREE')).toBe(true);
  const audit = await f.h.owner`SELECT action,entity FROM audit_log WHERE entity_id=${saleId}`;
  expect(audit).toEqual([{ action: 'package.sold', entity: 'package_entitlement' }]);
  const events = await outbox();
  expect(events).toHaveLength(1);
});
it('replays the stored 201 for the same key and body, and writes the sale once', async () => {
  const key = ids.newId();
  const input = f.saleInput();
  const before = await entitlements();
  const beforeEvents = (await outbox()).length;
  const first = await post(input, { key });
  const replay = await post(input, { key });
  expect(first.status).toBe(201);
  expect(replay.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  expect(await entitlements()).toHaveLength(before.length + 1);
  expect(await outbox()).toHaveLength(beforeEvents + 1);
});

it('refuses a changed quote with the stale code and writes nothing', async () => {
  const before = await entitlements();
  const response = await post(f.saleInput({ serviceRevision: 7 }));
  expect(response.status).toBe(409);
  expect(response.body['code']).toBe('PACKAGE_SALE_QUOTE_STALE');
  expect(await entitlements()).toHaveLength(before.length);
});

it('refuses a discount above the recorder limit and writes nothing', async () => {
  const before = await entitlements();
  const response = await post(f.saleInput({ pricePaid: '26.000' }));
  expect(response.status).toBe(422);
  expect(response.body['code']).toBe('PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT');
  expect(await entitlements()).toHaveLength(before.length);
});

it('refuses the seller selling to herself with the self-sale code and writes nothing', async () => {
  const before = await entitlements();
  await f.h.owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
  try {
    const response = await post(f.saleInput());
    expect(response.status).toBe(403);
    expect(response.body['code']).toBe('PACKAGE_SELLER_SELF_FORBIDDEN');
    expect(await entitlements()).toHaveLength(before.length);
  } finally {
    await f.h.owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
  }
});

it('refuses a branch of another company and writes nothing', async () => {
  const before = await entitlements();
  const response = await post(f.saleInput(), { company: f.otherCompany });
  expect(response.status).toBe(403);
  expect(await entitlements()).toHaveLength(before.length);
});

it('lets one sale win a race on the same key and keeps the second request on the stored answer', async () => {
  const key = ids.newId();
  const input = f.saleInput();
  const before = await entitlements();
  const [first, second] = await Promise.all([post(input, { key }), post(input, { key })]);
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(first.body['entitlement']).toEqual(second.body['entitlement']);
  expect(await entitlements()).toHaveLength(before.length + 1);
});

it('refuses a caller who is not a member of the company', async () => {
  const before = await entitlements();
  const response = await post(f.saleInput(), { cookie: f.ownerCookie, company: f.otherCompany });
  expect(response.status).toBe(403);
  expect(await entitlements()).toHaveLength(before.length);
});

it('keeps the sale rows invisible to another company', async () => {
  const response = await post(f.saleInput());
  expect(response.status).toBe(201);
  const saleId = (response.body['entitlement'] as { id: string }).id;
  const visible = await f.db.withTenant(f.otherCompany, (tx) =>
    tx.execute(sql`SELECT id FROM package_entitlements WHERE id=${saleId}`),
  );
  expect(visible).toHaveLength(0);
});
