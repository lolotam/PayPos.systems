import { afterAll, beforeAll, expect, it } from 'vitest';
import { recordingContext } from '@pospay/contracts';
import { type TenantWrappers, type Tx, SYSTEM_ROLES } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { ordersRecordingContextQuery } from '../orders.module.ts';
import { interceptDatabase, ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';
let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });
const get = (query = '', cookie = f.cookie, company = f.company, base = f.base) =>
  f.h.send('GET', `${base}/recording-context${query === '' ? '' : `?${query}`}`, { cookie, company });
const read = (db: TenantWrappers = f.db) => ordersRecordingContextQuery(db, f.clock).execute(f.context(), {});

it('record permission alone returns only own context and an advisory limit without writes', async () => {
  f.h.calls.statements.length = 0;
  const response = await get();
  expect(response.status).toBe(200);
  const result = recordingContext.parse(response.body);
  expect(result).toEqual({ generated_at: result.generated_at, business_timezone: 'Asia/Kuwait',
    recorder_membership_ids: [f.membership], recorder_membership_id: f.membership, discount_limit: { source: 'PERSON', bps: 1000 } });
  expect(Number.isFinite(Date.parse(result.generated_at))).toBe(true);
  expect(f.h.calls.statements.every(({ sql: statement }) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(statement))).toBe(true);
  expect((await f.h.send('GET', `${f.base}?date=2026-10-14`, { cookie: f.cookie, company: f.company })).status).toBe(403);
  expect((await get('user_id=' + f.ownerId)).status).toBe(400);
  expect((await get('recorder_membership_id=bad')).status).toBe(400);
});
it('ambiguity exposes only caller candidates and resolves only a verified explicit selection', async () => {
  const second = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps)
    VALUES(${f.company},${second},${f.userId},${must(SYSTEM_ROLES.find((r) => r.code === 'cashier')).id},'global','BUSINESS',${f.business},2500)`;
  try {
    const ambiguous = recordingContext.parse((await get()).body);
    expect(ambiguous.recorder_membership_ids).toEqual([f.membership, second].sort());
    expect(ambiguous.recorder_membership_id).toBeNull(); expect(ambiguous.discount_limit).toBeNull();
    expect(recordingContext.parse((await get(`recorder_membership_id=${second}`)).body).discount_limit).toEqual({ source: 'PERSON', bps: 2500 });
    expect(recordingContext.parse((await get(`recorder_membership_id=${f.membership}`)).body).discount_limit).toEqual({ source: 'PERSON', bps: 1000 });
    const [foreign] = await f.h.owner`SELECT id FROM memberships WHERE company_id=${f.otherCompany}`;
    const [otherPerson] = await f.h.owner`SELECT id FROM memberships WHERE company_id=${f.company} AND user_id=${f.ownerId}`;
    for (const selection of [must(foreign)['id'], must(otherPerson)['id'], ids.newId()])
      expect((await get(`recorder_membership_id=${String(selection)}`)).status).toBe(403);
    await f.h.owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.secondBranch} WHERE company_id=${f.company} AND id=${second}`;
    expect((await get(`recorder_membership_id=${second}`)).status).toBe(403);
    await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business},starts_at='2099-01-01' WHERE company_id=${f.company} AND id=${second}`;
    expect((await get(`recorder_membership_id=${second}`)).status).toBe(403);
    await f.h.owner`UPDATE memberships SET starts_at='2026-01-01',ends_at=now() WHERE company_id=${f.company} AND id=${second}`;
    expect((await get(`recorder_membership_id=${second}`)).status).toBe(403);
    expect(recordingContext.parse((await get()).body).recorder_membership_ids).toEqual([f.membership]);
  } finally { await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${second}`; }
});
it('returns fresh personal/business/unconfigured zero and owner unlimited', async () => {
  for (const value of [0, 10000]) {
    await f.h.owner`UPDATE memberships SET limit_bps=${value} WHERE company_id=${f.company} AND id=${f.membership}`;
    expect(recordingContext.parse((await get()).body).discount_limit).toEqual({ source: 'PERSON', bps: value });
  }
  await f.h.owner`UPDATE memberships SET limit_bps=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
  expect(recordingContext.parse((await get()).body).discount_limit).toEqual({ source: 'NOT_CONFIGURED', bps: 0 });
  await f.h.owner`INSERT INTO business_settings(company_id,business_id,limit_bps) VALUES(${f.company},${f.business},0)`;
  expect(recordingContext.parse((await get()).body).discount_limit).toEqual({ source: 'BUSINESS', bps: 0 });
  await f.h.owner`UPDATE business_settings SET limit_bps=1250 WHERE company_id=${f.company} AND business_id=${f.business}`;
  expect(recordingContext.parse((await get()).body).discount_limit).toEqual({ source: 'BUSINESS', bps: 1250 });
  expect(recordingContext.parse((await get('', f.ownerCookie)).body).discount_limit).toEqual({ source: 'OWNER', bps: null });
});
it('rejects scope mismatch, another tenant/branch, missing tenant and inactive place', async () => {
  for (const [company, base] of [[f.otherCompany, f.base], [f.company, `/v1/businesses/${f.secondBusiness}/branches/${f.branch}/service-sessions`],
    [f.company, `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/service-sessions`],
    [f.company, `/v1/businesses/${f.foreignBusiness}/branches/${f.foreignBranch}/service-sessions`]])
    expect((await get('', f.cookie, must(company), must(base))).status).toBe(403);
  expect((await f.h.send('GET', `${f.base}/recording-context`, { cookie: f.cookie })).status).toBe(403);
  await f.h.owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.branch}`;
  expect((await get('', f.ownerCookie)).status).toBe(403);
  await f.h.owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.branch}`;
});
it('rechecks DENY, grant expiry, membership expiry and feature inside the query', async () => {
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},'record:service-sessions:branch','DENY','BRANCH',${f.branch},'Synthetic context denial',${f.ownerId})`;
  expect((await get()).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership}`;
  await f.h.owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((r) => r.code === 'staff')).id} WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},'record:service-sessions:branch','ALLOW','BRANCH',${f.branch},'2020-01-01','Synthetic expired grant',${f.ownerId})`;
  expect((await get()).status).toBe(403); await expect(read()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership}`;
  await f.h.owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((r) => r.code === 'cashier')).id},ends_at=now() WHERE company_id=${f.company} AND id=${f.membership}`;
  expect((await get()).status).toBe(403);
  await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic disabled feature',${f.ownerId})`;
  expect((await get()).body['code']).toBe('FEATURE_DISABLED'); await expect(read()).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
});
it('refuses authority expiring during limit locks at the final injected instant', async () => {
  const until = new Date(f.clock.now().getTime() + 1000);
  await f.h.owner`UPDATE memberships SET ends_at=${until.toISOString()} WHERE company_id=${f.company} AND id=${f.membership}`;
  const db = interceptDatabase(f.db, async (statement) => { if (statement.includes('FROM business_settings')) f.setAt(until); });
  try { await expect(read(db)).rejects.toMatchObject({ code: 'FORBIDDEN' }); }
  finally { f.setAt(new Date('2026-10-15T08:00:00Z')); await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`; }
});
it('EXPLAIN ANALYZE checks the exact callback SQL and tenant/subject indexes', async () => {
  const plans: string[] = [];
  const db: TenantWrappers = { ...f.db, withTenant: (company, work, options) => f.db.withTenant(company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return work(new Proxy(tx, { get: (target, property, receiver) => property === 'execute' ? async (query: SQL) => {
      plans.push(JSON.stringify(await target.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`)));
      return target.execute(query);
    } : Reflect.get(target, property, receiver) }) as Tx);
  }, options) };
  expect((await read(db)).discount_limit).toEqual({ source: 'BUSINESS', bps: 1250 });
  const plan = plans.join('');
  for (const index of ['memberships_pkey', 'business_settings_pkey', 'businesses_pkey']) expect(plan).toContain(index);
  expect(plan).not.toContain('Seq Scan'); expect(plans.length).toBeGreaterThan(10);
});
it('requires a signed-in admin rather than either staff-session purpose', async () => {
  expect((await f.h.app.inject({ method: 'GET', url: `${f.base}/recording-context` })).statusCode).toBe(401);
  await f.h.owner`UPDATE "user" SET phone_number=(SELECT phone FROM customers WHERE company_id=${f.company} AND id=${f.customer}),phone_binding_approved_at='2026-01-01' WHERE id=${f.userId}`;
  for (const purpose of ['STAFF_POS', 'STAFF_PERSONAL']) {
    const issued = purpose === 'STAFF_POS'
      ? await f.h.auth.staff.issue(f.userId, { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: ids.newId() }, async () => true)
      : await f.h.auth.personal.issue(f.userId, { purpose: 'STAFF_PERSONAL', companyId: f.company, businessId: f.business }, async () => true);
    const cookie = must(issued.cookie.split(';')[0]);
    expect((await get('', cookie)).status).toBe(401);
    const renamed = `${must(f.cookie.split('=')[0])}=${cookie.slice(cookie.indexOf('=') + 1)}`;
    expect((await get('', renamed)).status).toBe(401);
  }
});
