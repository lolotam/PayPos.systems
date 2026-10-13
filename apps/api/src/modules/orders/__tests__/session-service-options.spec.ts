import { afterAll, beforeAll, expect, it } from 'vitest';
import { sessionServiceOptionPage } from '@pospay/contracts';
import { SYSTEM_ROLES, type TenantWrappers, type Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { sessionServiceOptions } from '../persistence/session-service-options.adapter.ts';
import { ordersServiceOptionsQuery } from '../orders.module.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => {
  f = await sessionFixture();
  await f.h.owner`UPDATE services SET name_en='Same name',name_ar='خدمة تجريبية',revision=7 WHERE company_id=${f.company} AND business_id=${f.business}`;
  for (const [company, business] of [[f.company, f.secondBusiness], [f.otherCompany, f.foreignBusiness]])
    await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES(${must(company)},${ids.newId()},${must(business)},'Outside','99999999999.999','ZERO')`;
});
afterAll(async () => { await f?.close(); });
const get = (query = '', cookie = f.cookie, company = f.company, base = f.base) =>
  f.h.send('GET', `${base}/service-options?lang=en&${query}`, { cookie, company });
const read = () => ordersServiceOptionsQuery(f.db, f.clock).execute(f.context(), { lang: 'en', limit: 2 });

it('record-only access returns exact picker fields, stable pages despite name ties, and no writes', async () => {
  f.h.calls.statements.length = 0;
  const first = await get('limit=2'); expect(first.status).toBe(200);
  const page = sessionServiceOptionPage.parse(first.body);
  expect(page).toEqual({ items: f.services.slice(0, 2).map((id, i) => ({ id, name_ar: 'خدمة تجريبية',
    name_en: 'Same name', price: ['25.000', '7.125'][i], revision: 7 })), next_cursor: expect.any(String) });
  const last = sessionServiceOptionPage.parse((await get(`limit=2&cursor=${page.next_cursor}`)).body);
  expect(last.items.map((r) => r.id)).toEqual(f.services.slice(2));
  expect(last.items.map((r) => r.price)).toEqual(['0.000', '15.000']); expect(last.next_cursor).toBeNull();
  expect((await get('limit=4')).body['next_cursor']).toBeNull();
  expect(f.h.calls.statements.every(({ sql: statement }) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(statement))).toBe(true);
  expect((await f.h.send('GET', `/v1/businesses/${f.business}/services`, { cookie: f.cookie, company: f.company })).status).toBe(403);
  expect((await f.h.send('GET', `${f.base}?date=2026-10-14`, { cookie: f.cookie, company: f.company })).status).toBe(403);
});
it('rejects invalid/unknown query fields', async () => {
  for (const query of ['limit=0', 'limit=101', 'cursor=bad', 'q=%00', 'q=', `recorder_membership_id=${f.membership}`])
    expect((await get(query)).status).toBe(400);
  expect((await f.h.send('GET', `${f.base}/service-options`, { cookie: f.cookie, company: f.company })).status).toBe(400);
});
it('rejects language/search mismatches, noncanonical cursors and cross-scope replay with 400', async () => {
  const cursor = must(sessionServiceOptionPage.parse((await get('limit=1')).body).next_cursor);
  for (const query of [`cursor=${cursor}&q=changed`, `cursor=${cursor.slice(0, -1)}`, `cursor=${cursor}=`])
    expect((await get(query)).status).toBe(400);
  expect((await f.h.send('GET', `${f.base}/service-options?lang=ar&cursor=${cursor}`, { cookie: f.cookie, company: f.company })).status).toBe(400);
  const sibling = ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${sibling},${f.business},'Synthetic sibling')`;
  for (const [company, business, branch] of [[f.company, f.business, sibling], [f.company, f.secondBusiness, f.secondBranch],
    [f.otherCompany, f.foreignBusiness, f.foreignBranch]])
    await expect(f.db.withTenant(must(company), (tx) => sessionServiceOptions(tx, must(company), must(business), must(branch),
      { lang: 'en', limit: 20, cursor }))).rejects.toThrow('SESSION_SERVICE_CURSOR_INVALID');
  expect((await get(`cursor=${cursor}`, f.ownerCookie, f.company,
    `/v1/businesses/${f.business}/branches/${sibling}/service-sessions`)).status).toBe(400);
});
it('refreshes list price/revision without requiring the broader catalog feature or permission', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'catalog',false,'Synthetic catalog feature off',${f.ownerId})`;
  await f.h.owner`UPDATE services SET price='99999999999.999',revision=8 WHERE company_id=${f.company} AND id=${must(f.services[0])}`;
  try {
    const response = await get('limit=1'); expect(response.status).toBe(200);
    expect(sessionServiceOptionPage.parse(response.body).items[0]).toMatchObject({ price: '99999999999.999', revision: 8 });
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='catalog'`;
    await f.h.owner`UPDATE services SET price='25.000',revision=7 WHERE company_id=${f.company} AND id=${must(f.services[0])}`;
  }
});
it('provider projection is exact, business-limited and protected by real RLS', async () => {
  const page = await f.db.withTenant(f.company, (tx) => sessionServiceOptions(tx, f.company, f.business, f.branch, { lang: 'en', limit: 20 }));
  expect(page).toEqual(sessionServiceOptionPage.parse((await get()).body));
  for (const [company, business] of [[f.company, f.foreignBusiness], [f.otherCompany, f.foreignBusiness]])
    expect(await f.db.withTenant(f.company, (tx) => sessionServiceOptions(tx, must(company), must(business), f.branch, { lang: 'en', limit: 20 })))
      .toEqual({ items: [], next_cursor: null });
  const outside = await f.db.withTenant(f.company, (tx) => sessionServiceOptions(tx, f.company, f.secondBusiness, f.secondBranch, { lang: 'en', limit: 20 }));
  expect(outside.items[0]?.price).toBe('99999999999.999');
});
it('refuses other tenant/branch, route mismatch and inactive place on each page', async () => {
  for (const [company, base] of [[f.otherCompany, f.base],
    [f.company, `/v1/businesses/${f.secondBusiness}/branches/${f.branch}/service-sessions`],
    [f.company, `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/service-sessions`],
    [f.company, `/v1/businesses/${f.foreignBusiness}/branches/${f.foreignBranch}/service-sessions`]])
    expect((await get(`cursor=${must(f.services[0])}`, f.cookie, must(company), must(base))).status).toBe(403);
  await f.h.owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.branch}`;
  try { expect((await get('', f.ownerCookie)).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' }); }
  finally { await f.h.owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.branch}`; }
});
it('rechecks missing/delegated authority, DENY, membership expiry and orders feature in the query', async () => {
  await f.h.owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((r) => r.code === 'staff')).id} WHERE company_id=${f.company} AND id=${f.membership}`;
  expect((await get()).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const grant = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${grant},${f.membership},'record:service-sessions:branch','ALLOW','BRANCH',${f.branch},'Synthetic option grant',${f.ownerId})`;
  expect((await get()).status).toBe(200);
  await f.h.owner`UPDATE permission_overrides SET expires_at='2020-01-01' WHERE company_id=${f.company} AND id=${grant}`;
  expect((await get()).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.h.owner`UPDATE permission_overrides SET expires_at=NULL,effect='DENY' WHERE company_id=${f.company} AND id=${grant}`;
  expect((await get()).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${grant}`;
  await f.h.owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((r) => r.code === 'cashier')).id},ends_at=now() WHERE company_id=${f.company} AND id=${f.membership}`;
  expect((await get()).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic feature refusal',${f.ownerId})`;
  expect((await get()).body['code']).toBe('FEATURE_DISABLED'); await expect(read()).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
});
it('requires selected company and admin authentication, refusing personal and device staff sessions', async () => {
  expect((await f.h.app.inject({ method: 'GET', url: `${f.base}/service-options` })).statusCode).toBe(401);
  expect((await f.h.send('GET', `${f.base}/service-options`, { cookie: f.cookie })).status).toBe(403);
  await f.h.owner`UPDATE "user" SET phone_number=(SELECT phone FROM customers WHERE company_id=${f.company} AND id=${f.customer}),phone_binding_approved_at='2026-01-01' WHERE id=${f.userId}`;
  const sessions = [await f.h.auth.staff.issue(f.userId, { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: ids.newId() }, async () => true),
    await f.h.auth.personal.issue(f.userId, { purpose: 'STAFF_PERSONAL', companyId: f.company, businessId: f.business }, async () => true)];
  for (const issued of sessions) expect((await get('', must(issued.cookie.split(';')[0]))).status).toBe(401);
});
it('EXPLAIN ANALYZE runs exact orders callback SQL for first/next pages using existing indexes', async () => {
  const plans: string[] = [];
  const db: TenantWrappers = { ...f.db, withTenant: (company, work, options) => f.db.withTenant(company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return work(new Proxy(tx, { get: (target, property, receiver) => property === 'execute' ? async (query: SQL) => {
      plans.push(JSON.stringify(await target.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`)));
      return target.execute(query);
    } : Reflect.get(target, property, receiver) }) as Tx);
  }, options) };
  const first = sessionServiceOptionPage.parse((await get('limit=1&q=same')).body);
  for (const cursor of [undefined, must(first.next_cursor)]) {
    plans.length = 0;
    const page = await ordersServiceOptionsQuery(db, f.clock).execute(f.context(), { lang: 'en', q: 'same', limit: 2, ...(cursor === undefined ? {} : { cursor }) });
    expect(page.items).toHaveLength(2);
    const plan = plans.join('');
    for (const index of ['services_company_business_id_key', 'memberships_', 'businesses_pkey']) expect(plan).toContain(index);
    expect(plan).not.toContain('Seq Scan');
  }
});
