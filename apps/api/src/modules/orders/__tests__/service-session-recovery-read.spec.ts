import { serviceSessionRecoveryPage } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { ordersRecoveryQuery } from '../orders.module.ts';
import { recoveryKeyHash } from '../persistence/session-recovery.adapter.ts';
import { AT, ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
const EPOCH = 'recovery_feature_started_at=2020-01-01T00:00:00.000000Z';
beforeAll(async () => {
  f = await sessionFixture({ ordersClock: { now: () => f?.clock.now() ?? AT } });
  await f.h.owner.unsafe(`COMMENT ON TABLE service_session_recoveries IS '${EPOCH}'`);
});
afterEach(() => { f?.setAt(AT); });
afterAll(async () => { await f?.close(); });

function recoveryUrl(operation = 'record-service-session', cursor?: string, base = f.base) {
  return `${base}/recovery?${new URLSearchParams({ operation, ...(cursor === undefined ? {} : { cursor }) })}`;
}
async function call(method: 'GET' | 'POST', url: string, key?: string, cookie = f.cookie, company = f.company, body?: object) {
  const res = await f.h.app.inject({ method, url, headers: { cookie, 'x-company-id': company, ...(key === undefined ? {} : { 'x-recovery-key': key }) },
    ...(body === undefined ? {} : { payload: body }) });
  return { status: res.statusCode, body: (res.body === '' ? {} : res.json()) as Record<string, unknown>, headers: res.headers, text: res.body };
}
const read = (key?: string, operation = 'record-service-session', cursor?: string, cookie = f.cookie, company = f.company, base = f.base) =>
  call('GET', recoveryUrl(operation, cursor, base), key, cookie, company);
async function openProof(key: string, operation = 'record-service-session') {
  await f.h.owner`UPDATE service_session_recoveries SET last_seen_at = issued_at - interval '25 hours'
    WHERE company_id=${f.company} AND operation=${operation} AND key_hash=${recoveryKeyHash(key)}`;
}
async function cashierOn(branchId: string) {
  const membership = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps)
    VALUES(${f.company},${membership},${f.userId},${must(SYSTEM_ROLES.find((role) => role.code === 'cashier')).id},'global','BRANCH',${branchId},1000)`;
  await f.h.owner`UPDATE memberships SET starts_at='2026-01-01T00:00:00Z' WHERE company_id=${f.company} AND id=${membership}`;
  return membership;
}

it('returns one NOT_FOUND for an unknown key, another recorder, another branch and another tenant', async () => {
  const key = ids.newId();
  await f.create.execute({ ...f.context(key), input: { ...f.body(), occurred_at: '2026-10-11T08:00:00.000Z' } });
  expect((await read(ids.newId())).body['code']).toBe('SESSION_RECOVERY_NOT_FOUND');
  expect((await read(key, 'record-service-session', undefined, f.ownerCookie)).body['code']).toBe('SESSION_RECOVERY_NOT_FOUND');
  const membership = await cashierOn(f.secondBranch);
  try {
    const other = `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/service-sessions`;
    expect((await read(key, 'record-service-session', undefined, f.cookie, f.company, other)).body['code']).toBe('SESSION_RECOVERY_NOT_FOUND');
  } finally { await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${membership}`; }
  const foreign = `/v1/businesses/${f.foreignBusiness}/branches/${f.foreignBranch}/service-sessions`;
  expect((await read(key, 'record-service-session', undefined, f.cookie, f.otherCompany, foreign)).body['code']).toBe('SESSION_RECOVERY_NOT_FOUND');
  expect((await read(key)).status).not.toBe(404);
});

it('refuses a recorder who lost record access or the orders feature before listing', async () => {
  const key = ids.newId();
  await f.create.execute({ ...f.context(key), input: f.body() });
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.membership},'record:service-sessions:branch','DENY','BRANCH',${f.branch},'Synthetic recovery denial',${f.ownerId})`;
  try {
    expect((await read(key)).status).toBe(403);
    await expect(ordersRecoveryQuery(f.db, f.clock).execute(f.context(key), 'record-service-session', key)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally { await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`; }
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic recovery feature',${f.ownerId})`;
  try { expect((await read(key)).body['code']).toBe('FEATURE_DISABLED'); }
  finally { await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`; }
});

it('stays NOT_YET until last_seen plus 24h and opens on that exact instant', async () => {
  const early = ids.newId();
  await f.create.execute({ ...f.context(early), input: f.body() });
  const closed = await read(early);
  expect(closed.status).toBe(409);
  expect(closed.body['code']).toBe('SESSION_RECOVERY_NOT_YET');
  expect(closed.body['details']).toEqual({ opens_at: '2026-10-16T08:00:00.000000Z' });
  expect(closed.body).not.toHaveProperty('attempt');
  await f.h.owner`UPDATE service_session_recoveries SET last_seen_at = issued_at - interval '24 hours'
    WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(early)}`;
  expect((await read(early)).status).toBe(200);
});

it('returns CLOSED after expires_at even while the 24h gate would still be early, and after confirm', async () => {
  const expired = ids.newId();
  await f.create.execute({ ...f.context(expired), input: f.body() });
  await f.h.owner`UPDATE service_session_recoveries SET expires_at = issued_at + interval '1 second' WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(expired)}`;
  f.setAt(new Date(AT.getTime() + 1000));
  const expiry = await read(expired);
  expect(expiry.body).toMatchObject({ code: 'SESSION_RECOVERY_CLOSED', details: { reason: 'EXPIRED' } });
  expect(expiry.body).not.toHaveProperty('attempt');
  const revoked = ids.newId();
  await f.create.execute({ ...f.context(revoked), input: f.body() });
  await openProof(revoked);
  expect((await call('POST', `${f.base}/recovery/confirm`, revoked, f.cookie, f.company, { operation: 'record-service-session', outcome: 'NOT_RECORDED' })).status).toBe(204);
  f.setAt(AT);
  expect((await read(revoked)).body).toMatchObject({ code: 'SESSION_RECOVERY_CLOSED', details: { reason: 'REVOKED' } });
});

it('parses an open committed page, sends no-store, and keeps the raw key out of SQL and the body', async () => {
  const key = ids.newId();
  const saved = await f.create.execute({ ...f.context(key), input: { ...f.body(), occurred_at: '2026-10-11T08:00:00.000Z' } });
  await openProof(key);
  f.h.calls.statements.length = 0;
  const response = await read(key);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const page = serviceSessionRecoveryPage.parse(response.body);
  expect(page.attempt).toMatchObject({ business_date: '2026-10-11', business_timezone: 'Asia/Kuwait', outcome: 'COMMITTED' });
  expect(page.items.map((item) => item.id)).toContain(saved.session.id);
  expect(page.items.every((item) => item.customer_phone_masked !== '+999999998123' && item.lines.length > 0)).toBe(true);
  expect(response.text).not.toContain(key);
  expect(f.h.calls.statements.some((statement) => statement.sql.includes(key))).toBe(false);
});

it('rejects a missing or malformed recovery key before any lookup', async () => {
  expect((await read()).status).toBe(400);
  expect((await read('has space')).body['code']).toBe('VALIDATION_FAILED');
  expect((await read('x'.repeat(256))).status).toBe(400);
  expect((await f.h.app.inject({ method: 'GET', url: recoveryUrl() })).statusCode).toBe(401);
});
