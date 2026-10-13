import { afterAll, beforeAll, expect, it } from 'vitest';
import { sessionPerformerOptionPage } from '@pospay/contracts';
import { SYSTEM_ROLES, type TenantWrappers, type Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { ordersPerformerOptionsQuery } from '../orders.module.ts';
import { sessionPerformerOptions } from '../persistence/session-performer-options.adapter.ts';
import { ids, must, sessionFixture, sessionPerformerOptionsStatement, type SessionFixture } from '../../../../test/service-session-picker.fixture.ts';

let f: SessionFixture;
const sibling = ids.newId();
const occurred_at = '2026-10-14T08:00:00Z';
beforeAll(async () => {
  f = await sessionFixture();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${sibling},${f.business},'Synthetic sibling')`;
  for (const [company, business, branch] of [[f.company, f.secondBusiness, f.secondBranch], [f.otherCompany, f.foreignBusiness, f.foreignBranch]]) {
    const employee = ids.newId();
    await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
      VALUES(${must(company)},${employee},${must(business)},${must(branch)},'Outside','outside','staff','2026-01-01')`;
    await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
      VALUES(${must(company)},${ids.newId()},${must(business)},${employee},${must(branch)},'2026-01-01')`;
  }
  await f.h.owner`UPDATE employees SET name_en='Same NAME',name_ar='سارة',user_id=${f.userId} WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
  await f.h.owner`UPDATE employees SET name_en='Same NAME',name_ar='سارة' WHERE company_id=${f.company} AND id=${must(f.employees[1])}`;
});
afterAll(async () => { await f?.close(); });
const get = (query = '', cookie = f.cookie, company = f.company, base = f.base) =>
  f.h.send('GET', `${base}/performer-options?occurred_at=${occurred_at}${query === '' ? '' : `&${query}`}`, { cookie, company });
const read = () => ordersPerformerOptionsQuery(f.db, f.clock).execute(f.context(), { occurred_at, limit: 2 });

it('record-only access yields exact private-field-free pages, stable cursors with name ties, and no writes', async () => {
  f.h.calls.statements.length = 0;
  const first = await get('limit=2'); expect(first.status).toBe(200);
  const page = sessionPerformerOptionPage.parse(first.body);
  expect(page).toEqual({ items: f.employees.slice(0, 2).map((id) => ({ id, name_ar: 'سارة', name_en: 'Same NAME',
    not_clocked_in_warning: true, approved_leave_warning: false })), next_cursor: f.employees[1] });
  const last = sessionPerformerOptionPage.parse((await get(`limit=2&cursor=${page.next_cursor}`)).body);
  expect(last.items.map((r) => r.id)).toEqual(f.employees.slice(2)); expect(last.next_cursor).toBeNull();
  expect((await get(`cursor=${must(f.employees.at(-1))}`)).body).toEqual({ items: [], next_cursor: null });
  expect((await get('limit=4')).body['next_cursor']).toBeNull();
  expect(f.h.calls.statements.every(({ sql: statement }) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(statement))).toBe(true);
  expect((await f.h.send('GET', `${f.base}?date=2026-10-14`, { cookie: f.cookie, company: f.company })).status).toBe(403);
});
it('searches either name case-insensitively after trimming before cursor pagination', async () => {
  for (const q of ['sAmE', '  سارة  ']) {
    const page = sessionPerformerOptionPage.parse((await get(`limit=1&q=${encodeURIComponent(q)}`)).body);
    expect(page.items.map((r) => r.id)).toEqual([f.employees[0]]); expect(page.next_cursor).toBe(f.employees[0]);
    const last = sessionPerformerOptionPage.parse((await get(`limit=1&q=${encodeURIComponent(q)}&cursor=${page.next_cursor}`)).body);
    expect(last.items.map((r) => r.id)).toEqual([f.employees[1]]); expect(last.next_cursor).toBeNull();
  }
  for (const q of ['absent', '%', '_']) expect((await get(`q=${q}`)).body).toEqual({ items: [], next_cursor: null });
  for (const query of ['limit=0', 'limit=101', 'cursor=bad', 'q=', 'q=%20', `q=${'a'.repeat(51)}`, 'user_id=bad']) expect((await get(query)).status).toBe(400);
  for (const query of ['', 'occurred_at=bad']) expect((await f.h.send('GET', `${f.base}/performer-options?${query}`, { cookie: f.cookie, company: f.company })).status).toBe(400);
});
it('provider respects real RLS, business and dated branch links; cannot enumerate another scope', async () => {
  expect(await f.db.withTenant(f.company, (tx) => tx.execute(sessionPerformerOptionsStatement(
    f.otherCompany, f.foreignBusiness, f.foreignBranch, '2026-10-14', { occurred_at, limit: 20 })))).toHaveLength(0);
  expect((await f.db.withTenant(f.company, (tx) => sessionPerformerOptions(tx, f.company, f.secondBusiness, f.secondBranch,
    { occurred_at, limit: 20 }))).items).toHaveLength(1);
  for (const [company, business, branch] of [[f.company, f.business, sibling], [f.otherCompany, f.foreignBusiness, f.foreignBranch]])
    expect(await f.db.withTenant(f.company, (tx) => sessionPerformerOptions(tx, must(company), must(business), must(branch), { occurred_at, limit: 20 })))
      .toEqual({ items: [], next_cursor: null });
  const employee = must(f.employees[3]);
  await f.h.owner`UPDATE employee_branches SET "to"='2026-10-14' WHERE company_id=${f.company} AND employee_id=${employee}`;
  expect(sessionPerformerOptionPage.parse((await get()).body).items.map((r) => r.id)).not.toContain(employee);
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${ids.newId()},${f.business},${employee},${f.branch},'2026-10-14')`;
  for (const [company, base] of [[f.otherCompany, f.base], [f.company, `/v1/businesses/${f.secondBusiness}/branches/${f.branch}/service-sessions`],
    [f.company, `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/service-sessions`]])
    expect((await get(`cursor=${employee}`, f.cookie, must(company), must(base))).status).toBe(403);
  await f.h.owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.branch}`;
  try { expect((await get('', f.ownerCookie)).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' }); }
  finally { await f.h.owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.branch}`; }
});
it('rechecks absent/delegated authority, DENY, expiry and orders feature inside the query', async () => {
  await f.h.owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((r) => r.code === 'staff')).id} WHERE company_id=${f.company} AND id=${f.membership}`;
  expect((await get()).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const grant = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${grant},${f.membership},'record:service-sessions:branch','ALLOW','BRANCH',${f.branch},'Synthetic picker grant',${f.ownerId})`;
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'staff',false,'Synthetic HR feature off',${f.ownerId})`;
  expect((await get()).status).toBe(200);
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  for (const effect of ['EXPIRED', 'DENY']) {
    await f.h.owner`UPDATE permission_overrides SET effect=${effect === 'DENY' ? 'DENY' : 'ALLOW'},expires_at=${effect === 'EXPIRED' ? '2020-01-01' : null}
      WHERE company_id=${f.company} AND id=${grant}`;
    expect((await get()).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${grant}`;
  await f.h.owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((r) => r.code === 'cashier')).id},ends_at=now() WHERE company_id=${f.company} AND id=${f.membership}`;
  expect((await get()).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic feature off',${f.ownerId})`;
  expect((await get()).body['code']).toBe('FEATURE_DISABLED'); await expect(read()).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
});
it('requires selected company/admin, refusing staff-session purposes', async () => {
  expect((await f.h.app.inject({ method: 'GET', url: `${f.base}/performer-options?occurred_at=${occurred_at}` })).statusCode).toBe(401);
  expect((await f.h.send('GET', `${f.base}/performer-options?occurred_at=${occurred_at}`, { cookie: f.cookie })).status).toBe(403);
  await f.h.owner`UPDATE "user" SET phone_number=(SELECT phone FROM customers WHERE company_id=${f.company} AND id=${f.customer}),phone_binding_approved_at='2026-01-01' WHERE id=${f.userId}`;
  const sessions = [await f.h.auth.staff.issue(f.userId, { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: ids.newId() }, async () => true),
    await f.h.auth.personal.issue(f.userId, { purpose: 'STAFF_PERSONAL', companyId: f.company, businessId: f.business }, async () => true)];
  for (const issued of sessions) expect((await get('', must(issued.cookie.split(';')[0]))).status).toBe(401);
});
it('EXPLAIN ANALYZE covers exact orders callbacks and staff SQL for first/next searched pages', async () => {
  const plans: string[] = [];
  const db: TenantWrappers = { ...f.db, withTenant: (company, work, options) => f.db.withTenant(company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return work(new Proxy(tx, { get: (target, property, receiver) => property === 'execute' ? async (query: SQL) => {
      plans.push(JSON.stringify(await target.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`))); return target.execute(query);
    } : Reflect.get(target, property, receiver) }) as Tx);
  }, options) };
  for (const cursor of [undefined, must(f.employees[0])]) {
    plans.length = 0;
    expect((await ordersPerformerOptionsQuery(db, f.clock).execute(f.context(), { occurred_at, q: 'same', limit: 1,
      ...(cursor === undefined ? {} : { cursor }) })).items).toHaveLength(1);
    const plan = plans.join('');
    for (const name of ['employees_', 'employee_branches_', 'memberships_', 'businesses_pkey']) expect(plan).toContain(name);
    expect(plan).not.toContain('Seq Scan');
  }
});
