import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { SYSTEM_ROLES } from '@pospay/db';
import { serviceSessionDayPage } from '@pospay/contracts';
import { SessionAdminGuard } from '../http/session-access.guard.ts';
import { ordersDayQuery } from '../orders.module.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => {
  f = await sessionFixture();
  await f.create.execute({ ...f.context(), input: f.body() });
  await f.create.execute({ ...f.context(), input: f.body() });
});
afterAll(async () => { await f?.close(); });
const permission = 'read:service-sessions:branch';
const get = (query = 'date=2026-10-14', cookie = f.cookie, company = f.company, base = f.base) =>
  f.h.send('GET', `${base}?${query}`, { cookie, company });
async function role(code: string, scope = 'BRANCH', scopeId = f.branch) {
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership}`;
  await f.h.owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((r) => r.code === code)).id},scope_type=${scope},scope_id=${scopeId},ends_at=NULL
    WHERE company_id=${f.company} AND id=${f.membership}`;
}
async function override(effect: string, expires: string | null = null) {
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},${permission},${effect},'BRANCH',${f.branch},${expires},'Synthetic read access test',${f.ownerId})`;
}

it('seeds exactly the four defaults and keeps reception recording separate', async () => {
  const rows = await f.h.owner`SELECT r.code FROM roles r JOIN role_permissions p ON p.role_id=r.id AND p.role_owner_key=r.owner_key
    WHERE r.company_id IS NULL AND p.permission_code=${permission} ORDER BY r.code`;
  expect(rows.map((row) => row['code'])).toEqual(['branch_manager', 'business_manager', 'general_manager', 'owner']);
  expect((await get()).status).toBe(403);
  expect((await get('date=2026-10-14', f.ownerCookie)).status).toBe(200);
  const record = await f.h.send('POST', f.base, { cookie: f.cookie, company: f.company, key: ids.newId(), body: { customer_id: f.customer, lines: [f.line()] } });
  expect(record.status).toBe(201);
  for (const [code, scope, scopeId] of [['general_manager', 'COMPANY', f.company], ['business_manager', 'BUSINESS', f.business], ['branch_manager', 'BRANCH', f.branch]]) {
    await role(must(code), must(scope), must(scopeId));
    expect((await get()).status).toBe(200);
    expect((await get('date=2026-10-14', f.cookie, f.company, `/v1/businesses/${f.secondBusiness}/branches/${f.branch}/service-sessions`)).status).toBe(403);
  }
  await role('branch_manager');
  expect((await get('date=2026-10-14', f.cookie, f.company, `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/service-sessions`)).status).toBe(403);
});

it('allows explicit human delegation but applies DENY, expiry and revocation on every page and query', async () => {
  await role('staff');
  expect((await get()).status).toBe(403);
  await override('ALLOW');
  const page = await get('date=2026-10-14&limit=1');
  expect(page.status).toBe(200);
  const cursor = must(serviceSessionDayPage.parse(page.body).next_cursor);
  const scoped = { ...f.context(), userId: f.userId };
  expect((await ordersDayQuery(f.db).execute(scoped, { date: '2026-10-14', limit: 1 })).items).toHaveLength(1);
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership}`;
  expect((await get(`date=2026-10-14&cursor=${cursor}`)).status).toBe(403);
  await expect(ordersDayQuery(f.db).execute(scoped, { date: '2026-10-14', limit: 1, cursor })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await override('ALLOW', '2020-01-01T00:00:00Z');
  expect((await get()).status).toBe(403);
  await role('branch_manager'); await override('DENY');
  expect((await get()).status).toBe(403);
  await role('branch_manager');
  await f.h.owner`UPDATE memberships SET ends_at=now() WHERE company_id=${f.company} AND id=${f.membership}`;
  expect((await get()).status).toBe(403);
});

it('respects selected tenant, orders feature, unknown branches and strict query/cursor validation', async () => {
  await role('branch_manager');
  expect((await get('date=2026-10-14', f.cookie, f.otherCompany)).status).toBe(403);
  expect((await get('date=2026-10-14', f.ownerCookie, f.company, `/v1/businesses/${f.business}/branches/${ids.newId()}/service-sessions`)).status).toBe(403);
  for (const query of ['', 'date=0000-01-01', 'date=2026-02-29', 'date=2026-10-14&late=false', 'date=2026-10-14&limit=101',
    'date=2026-10-14&cursor=abc', 'date=2026-10-14&employee_id=client']) expect((await get(query)).status).toBe(400);
  const page = serviceSessionDayPage.parse((await get('date=2026-10-14&limit=1')).body);
  expect((await get(`date=2026-10-15&cursor=${must(page.next_cursor)}`)).status).toBe(400);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic read feature test',${f.ownerId})`;
  const disabled = await get(); expect(disabled.status).toBe(403); expect(disabled.body['code']).toBe('FEATURE_DISABLED');
  await expect(ordersDayQuery(f.db).execute({ ...f.context(), userId: f.ownerId }, { date: '2026-10-14', limit: 20 }))
    .rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  expect((await get()).status).toBe(200);
  expect((await f.h.app.inject({ method: 'GET', url: `${f.base}?date=2026-10-14` })).statusCode).toBe(401);
});

it.each(['device', 'api-key'])('admin guard refuses the %s principal', (kind) => {
  const context = { switchToHttp: () => ({ getRequest: () => ({ principal: { kind } }) }) } as unknown as ExecutionContext;
  expect(() => new SessionAdminGuard().canActivate(context)).toThrow();
});

it.each(['STAFF_POS', 'STAFF_PERSONAL'])('HTTP refuses a valid cookie with the %s purpose', async (purpose) => {
  await role('branch_manager');
  expect((await get()).status).toBe(200);
  await f.h.owner`UPDATE "user" SET phone_number=(SELECT phone FROM customers WHERE company_id=${f.company} AND id=${f.customer}) WHERE id=${f.userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at='2026-01-01' WHERE id=${f.userId}`;
  const issued = purpose === 'STAFF_POS'
    ? await f.h.auth.staff.issue(f.userId, { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: ids.newId() }, async () => true)
    : await f.h.auth.personal.issue(f.userId, { purpose: 'STAFF_PERSONAL', companyId: f.company, businessId: f.business }, async () => true);
  const cookie = must(issued.cookie.split(';')[0]);
  expect((await get('date=2026-10-14', cookie)).status).toBe(401);
  const normalCookieName = must(f.cookie.split('=')[0]);
  const renamed = `${normalCookieName}=${cookie.slice(cookie.indexOf('=') + 1)}`;
  expect((await get('date=2026-10-14', renamed)).status).toBe(401);
});
