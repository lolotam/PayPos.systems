import { recordServiceSessionResponse, sessionTips, type SessionTipEntry } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { serviceSessionErrors } from '@pospay/i18n';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });

const tipsUrl = (sessionId: string, branch = f.branch, business = f.business) =>
  `/v1/businesses/${business}/branches/${branch}/service-sessions/${sessionId}/tips`;

function firstTips(): { expected_revision: number; tips: SessionTipEntry[] } {
  const employee = must(f.employees[0]);
  return {
    expected_revision: 0,
    tips: [
      { employee_id: employee, method: 'CASH', amount: '1.500' },
      { employee_id: employee, method: 'CARD', amount: '2.250' },
    ],
  };
}

async function put(url: string, body: object, cookie = f.cookie, key: string | null = ids.newId(), company = f.company) {
  const res = await f.h.app.inject({
    method: 'PUT', url, payload: body,
    headers: { cookie, 'x-company-id': company, ...(key === null ? {} : { 'idempotency-key': key }) },
  });
  return { status: res.statusCode, body: (res.body === '' ? {} : res.json()) as Record<string, unknown>, text: res.body, headers: res.headers };
}

async function savedVisit() {
  const response = await f.h.send('POST', f.base, {
    cookie: f.cookie, company: f.company, key: ids.newId(),
    body: { customer_id: f.customer, lines: [f.line()] },
  });
  expect(response.status).toBe(201);
  return recordServiceSessionResponse.parse(response.body).session.id;
}

async function tipCounts(sessionId: string) {
  const revisions = await f.h.owner`SELECT 1 FROM session_tip_revisions WHERE company_id=${f.company} AND session_id=${sessionId}`;
  const entries = await f.h.owner`SELECT 1 FROM session_tips WHERE company_id=${f.company} AND session_id=${sessionId}`;
  return { revisions: revisions.length, entries: entries.length };
}

async function copySession(sourceId: string, company: string, business: string, branch: string, customer: string, membership: string) {
  const sessionId = ids.newId();
  await f.h.owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
    SELECT ${company},${sessionId},${business},${branch},${customer},s.customer_name,s.customer_phone_masked,
      s.occurred_at,s.recorded_at,s.business_date,s.business_timezone,${f.userId},${membership},s.late
    FROM service_sessions s WHERE s.company_id=${f.company} AND s.id=${sourceId}`;
  return sessionId;
}

it('GET returns the empty contract, then the same set PUT saved, with no private fields', async () => {
  const sessionId = await savedVisit();
  const url = tipsUrl(sessionId);
  const empty = sessionTips.parse((await f.h.send('GET', url, { cookie: f.cookie, company: f.company })).body);
  expect(empty).toEqual({ revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' });
  const body = firstTips();
  const saved = await put(url, body);
  expect(saved.status).toBe(200);
  const written = sessionTips.parse(saved.body);
  const read = sessionTips.parse((await f.h.send('GET', url, { cookie: f.cookie, company: f.company })).body);
  expect(read).toEqual(written);
  expect(read.tips.map((entry) => entry.method)).toEqual(['CARD', 'CASH']);
  expect(read).toMatchObject({ revision: 1, total_cash: '1.500', total_card: '2.250' });
  expect(Object.keys(read).sort()).toEqual(['revision', 'tips', 'total_card', 'total_cash']);
  expect(read.tips.every((entry) => Object.keys(entry).sort().join() === 'amount,employee_id,method')).toBe(true);
  const reason = `sentinel-${ids.newId()}`;
  const replaced = await put(url, {
    expected_revision: 1,
    tips: body.tips.map((entry, index) => index === 0 ? { ...entry, amount: '1.750' } : entry),
    reason,
  });
  expect(replaced.status).toBe(200);
  const again = sessionTips.parse((await f.h.send('GET', url, { cookie: f.cookie, company: f.company })).body);
  expect(again.revision).toBe(2);
  expect(JSON.stringify(again)).not.toContain(reason);
  expect(JSON.stringify(again)).not.toMatch(/phone|customer/i);
});

it('TP-03 a foreign session, an unknown session and another branch are byte-identical', async () => {
  const source = await savedVisit();
  const customer = ids.newId();
  await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${f.otherCompany},${customer},'Synthetic other customer','+999999990001','en',now(),now())`;
  const memberships = await f.h.owner`SELECT id FROM memberships WHERE company_id=${f.otherCompany} AND user_id=${f.userId}`;
  const foreign = await copySession(source, f.otherCompany, f.foreignBusiness, f.foreignBranch, customer, must(memberships[0])['id'] as string);
  const branch = ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${branch},${f.business},'Synthetic tip branch')`;
  const outside = await copySession(source, f.company, f.business, branch, f.customer, f.membership);
  const otherBusiness = await copySession(source, f.company, f.secondBusiness, f.secondBranch, f.customer, f.membership);
  const before = await f.h.owner`SELECT 1 FROM session_tip_revisions WHERE company_id=${f.company}`;
  const targets = [ids.newId(), foreign, outside, otherBusiness];
  const puts = [];
  const gets = [];
  for (const sessionId of targets) {
    puts.push(await put(tipsUrl(sessionId), firstTips()));
    gets.push(await f.h.send('GET', tipsUrl(sessionId), { cookie: f.cookie, company: f.company }));
  }
  const putShell = puts.map((reply) => shell(reply.headers));
  const getShell = gets.map((reply) => shell(reply.headers));
  expect(puts.map((reply) => reply.status)).toEqual([404, 404, 404, 404]);
  expect(gets.map((reply) => reply.status)).toEqual([404, 404, 404, 404]);
  expect(puts[0]?.text).toBe(puts[1]?.text);
  expect(puts[0]?.text).toBe(puts[2]?.text);
  expect(puts[0]?.text).toBe(puts[3]?.text);
  expect(gets[0]?.text).toBe(gets[1]?.text);
  expect(gets[0]?.text).toBe(gets[2]?.text);
  expect(gets[0]?.text).toBe(gets[3]?.text);
  expect(puts[0]?.text).toBe(gets[0]?.text);
  expect(putShell).toEqual([putShell[0], putShell[0], putShell[0], putShell[0]]);
  expect(getShell).toEqual(putShell);
  expect(puts[0]?.body).toEqual({ code: 'SESSION_NOT_FOUND', ...serviceSessionErrors.SESSION_NOT_FOUND });
  const after = await f.h.owner`SELECT 1 FROM session_tip_revisions WHERE company_id=${f.company}`;
  expect(after.length).toBe(before.length);
});

it('TP-10 the same key and body replays, and another body is refused', async () => {
  const sessionId = await savedVisit();
  const otherId = await savedVisit();
  const url = tipsUrl(sessionId);
  const body = firstTips();
  const key = ids.newId();
  const missing = await put(url, body, f.cookie, null);
  expect(missing.status).toBe(400);
  expect(missing.body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
  expect(await tipCounts(sessionId)).toEqual({ revisions: 0, entries: 0 });
  const first = await put(url, body, f.cookie, key);
  expect(first.status).toBe(200);
  const saved = await tipCounts(sessionId);
  const held = await effects(sessionId, key);
  const replay = await put(url, body, f.cookie, key);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  expect(await tipCounts(sessionId)).toEqual(saved);
  expect(await effects(sessionId, key)).toEqual(held);
  const changed = { ...body, tips: body.tips.map((entry, index) => index === 0 ? { ...entry, amount: '9.000' } : entry) };
  const other = await put(url, changed, f.cookie, key);
  expect(other.status).toBe(422);
  expect(other.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  expect(await tipCounts(sessionId)).toEqual(saved);
  expect(await effects(sessionId, key)).toEqual(held);
  const moved = await put(tipsUrl(otherId), firstTips(), f.cookie, key);
  expect(moved.status).toBe(422);
  expect(moved.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  expect(await effects(sessionId, key)).toEqual(held);
  expect(await tipCounts(otherId)).toEqual({ revisions: 0, entries: 0 });
  expect(await effects(otherId, key)).toEqual({ audits: [], events: [], keys: held.keys });
});

it('TP-14 another company cannot read or write, and a foreign employee writes nothing', async () => {
  const sessionId = await savedVisit();
  const url = tipsUrl(sessionId);
  const before = await tipCounts(sessionId);
  const write = await put(url, firstTips(), f.cookie, ids.newId(), f.otherCompany);
  const read = await f.h.send('GET', url, { cookie: f.cookie, company: f.otherCompany });
  expect(write.status).toBe(403);
  expect(read.status).toBe(403);
  expect(write.body['code']).toBe('FORBIDDEN');
  expect(read.body['code']).toBe('FORBIDDEN');
  const employee = ids.newId();
  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.otherCompany},${employee},${f.foreignBusiness},${f.foreignBranch},'Synthetic foreign employee','synthetic foreign employee','staff','2026-01-01')`;
  const rejected = await put(url, { expected_revision: 0, tips: [{ employee_id: employee, method: 'CASH', amount: '1.000' }] });
  expect(rejected.status).toBe(422);
  expect(rejected.body).toMatchObject({ code: 'TIP_EMPLOYEE_NOT_PERFORMER', ...serviceSessionErrors.TIP_EMPLOYEE_NOT_PERFORMER });
  expect(await tipCounts(sessionId)).toEqual(before);
  const abroad = tipsUrl(sessionId, f.foreignBranch, f.foreignBusiness);
  const unknown = tipsUrl(ids.newId(), f.foreignBranch, f.foreignBusiness);
  const crossWrite = await put(abroad, firstTips(), f.cookie, ids.newId(), f.otherCompany);
  const ghostWrite = await put(unknown, firstTips(), f.cookie, ids.newId(), f.otherCompany);
  expect(crossWrite.status).toBe(404);
  expect(crossWrite.text).toBe(ghostWrite.text);
  expect(crossWrite.body).toEqual({ code: 'SESSION_NOT_FOUND', ...serviceSessionErrors.SESSION_NOT_FOUND });
  const crossRead = await f.h.send('GET', abroad, { cookie: f.cookie, company: f.otherCompany });
  const ghostRead = await f.h.send('GET', unknown, { cookie: f.cookie, company: f.otherCompany });
  expect(crossRead.status).toBe(404);
  expect(crossRead.text).toBe(ghostRead.text);
  expect(crossRead.text).toBe(crossWrite.text);
  expect(await f.h.owner`SELECT 1 FROM session_tip_revisions WHERE session_id=${sessionId}`).toHaveLength(before.revisions);
});

it('a caller without record permission, a device, and a disabled orders feature are refused', async () => {
  const sessionId = await savedVisit();
  const url = tipsUrl(sessionId);
  const viewer = await viewerCookie();
  const denied = await put(url, firstTips(), viewer);
  const deniedRead = await f.h.send('GET', url, { cookie: viewer, company: f.company });
  expect(denied.status).toBe(403);
  expect(deniedRead.status).toBe(403);
  expect(denied.body['code']).toBe('FORBIDDEN');
  expect(deniedRead.body['code']).toBe('FORBIDDEN');
  const device = await paired(f.h, f.ownerCookie, f.company, f.branch);
  const deviceHeaders = { authorization: `Device ${device.token}`, origin, 'x-company-id': f.company };
  const deviceWrite = await f.h.app.inject({ method: 'PUT', url, headers: { ...deviceHeaders, 'idempotency-key': ids.newId() }, payload: firstTips() });
  const deviceRead = await f.h.app.inject({ method: 'GET', url, headers: deviceHeaders });
  expect(deviceWrite.statusCode).toBe(403);
  expect(deviceRead.statusCode).toBe(403);
  expect(deviceWrite.json().code).toBe('FORBIDDEN');
  expect(deviceRead.json().code).toBe('FORBIDDEN');
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic tip feature',${f.ownerId})`;
  try {
    const disabled = await put(url, firstTips());
    const disabledRead = await f.h.send('GET', url, { cookie: f.cookie, company: f.company });
    expect(disabled.status).toBe(403);
    expect(disabledRead.status).toBe(403);
    expect(disabled.body['code']).toBe('FEATURE_DISABLED');
    expect(disabledRead.body['code']).toBe('FEATURE_DISABLED');
  }
  finally { await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`; }
  expect(await tipCounts(sessionId)).toEqual({ revisions: 0, entries: 0 });
});

function shell(headers: { readonly [name: string]: unknown }) {
  const type = headers['content-type'];
  const length = headers['content-length'];
  expect(type).toEqual(expect.any(String));
  expect(String(length)).toMatch(/^\d+$/);
  return `${type as string} ${String(length)}`;
}

async function effects(sessionId: string, key: string) {
  const audits = await f.h.owner`SELECT action, before, after, xmin::text AS xmin
    FROM audit_log WHERE company_id=${f.company} AND entity='service_session_tips' AND entity_id=${sessionId} ORDER BY action`;
  const events = await f.h.owner`SELECT id, payload, xmin::text AS xmin
    FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='SessionTipsChanged' ORDER BY id`;
  const keys = await f.h.owner`SELECT operation, request_fingerprint, response_status, response_body, xmin::text AS xmin
    FROM idempotency_keys WHERE company_id=${f.company} AND key=${key} AND operation='record-session-tips'`;
  return { audits, events, keys };
}

async function viewerCookie() {
  const cookie = await f.h.signedInOperator('session-tips-viewer@example.test');
  const users = await f.h.owner`SELECT id FROM "user" WHERE email='session-tips-viewer@example.test'`;
  const userId = must(users[0])['id'] as string;
  const role = must(SYSTEM_ROLES.find((item) => item.code === 'viewer')).id;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${ids.newId()},${userId},${role},'global','BRANCH',${f.branch},0,'2026-01-01T00:00:00Z')`;
  return cookie;
}
