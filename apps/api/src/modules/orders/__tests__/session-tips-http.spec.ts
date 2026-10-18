import { recordServiceSessionResponse, sessionTips, type SessionTipEntry } from '@pospay/contracts';
import { serviceSessionErrors } from '@pospay/i18n';
import { afterAll, beforeAll, expect, it } from 'vitest';
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
  return { status: res.statusCode, body: (res.body === '' ? {} : res.json()) as Record<string, unknown>, text: res.body };
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
  const before = await f.h.owner`SELECT 1 FROM session_tip_revisions WHERE company_id=${f.company}`;
  const targets = [ids.newId(), foreign, outside];
  const puts = [];
  const gets = [];
  for (const sessionId of targets) {
    puts.push(await put(tipsUrl(sessionId), firstTips()));
    gets.push(await f.h.send('GET', tipsUrl(sessionId), { cookie: f.cookie, company: f.company }));
  }
  expect(puts.map((reply) => reply.status)).toEqual([404, 404, 404]);
  expect(gets.map((reply) => reply.status)).toEqual([404, 404, 404]);
  expect(puts[0]?.text).toBe(puts[1]?.text);
  expect(puts[0]?.text).toBe(puts[2]?.text);
  expect(gets[0]?.text).toBe(gets[1]?.text);
  expect(gets[0]?.text).toBe(gets[2]?.text);
  expect(puts[0]?.text).toBe(gets[0]?.text);
  expect(puts[0]?.body).toEqual({ code: 'SESSION_NOT_FOUND', ...serviceSessionErrors.SESSION_NOT_FOUND });
  const after = await f.h.owner`SELECT 1 FROM session_tip_revisions WHERE company_id=${f.company}`;
  expect(after.length).toBe(before.length);
});

it('TP-10 the same key and body replays, and another body is refused', async () => {
  const sessionId = await savedVisit();
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
  const replay = await put(url, body, f.cookie, key);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  expect(await tipCounts(sessionId)).toEqual(saved);
  const changed = { ...body, tips: body.tips.map((entry, index) => index === 0 ? { ...entry, amount: '9.000' } : entry) };
  const other = await put(url, changed, f.cookie, key);
  expect(other.status).toBe(422);
  expect(other.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  expect(await tipCounts(sessionId)).toEqual(saved);
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
});
