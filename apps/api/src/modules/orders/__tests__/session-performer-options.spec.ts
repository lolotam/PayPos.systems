import { afterAll, beforeAll, expect, it } from 'vitest';
import { sessionPerformerOptionPage } from '@pospay/contracts';
import { SYSTEM_ROLES, type TenantWrappers, type Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { ordersPerformerOptionsQuery } from '../orders.module.ts';
import { sessionPerformerOptions } from '../persistence/session-performer-options.adapter.ts';
import { ids, AT, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
const sibling = ids.newId();
const occurred_at = '2026-10-14T08:00:00Z';
beforeAll(async () => {
  f = await sessionFixture({ ordersClock: { now: () => f?.clock.now() ?? AT } });
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${sibling},${f.business},'Synthetic sibling')`;
  for (const [company, business, branch] of [[f.company, f.secondBusiness, f.secondBranch], [f.otherCompany, f.foreignBusiness, f.foreignBranch]]) {
    const employee = ids.newId();
    await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
      VALUES(${must(company)},${employee},${must(business)},${must(branch)},'Outside','outside','staff','2026-01-01')`;
    await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
      VALUES(${must(company)},${ids.newId()},${must(business)},${employee},${must(branch)},'2026-01-01')`;
  }
  for (const [i, [en, ar]] of [['ZULU', 'باء'], ['ZULU', 'باء'], ['Alpha', 'ياء'], ['Beta', null]].entries())
    await f.h.owner`UPDATE employees SET name_en=${must(en)},name_ar=${ar ?? null} WHERE company_id=${f.company} AND id=${must(f.employees[i])}`;
  await f.h.owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
});
afterAll(async () => { await f?.close(); });
const get = (query = '', cookie = f.cookie, company = f.company, base = f.base) =>
  f.h.send('GET', `${base}/performer-options?occurred_at=${occurred_at}&${query.includes('lang=') ? query : `lang=en&${query}`}`, { cookie, company });
const read = () => ordersPerformerOptionsQuery(f.db, f.clock).execute(f.context(), { occurred_at, lang: 'en', limit: 2 });
const cursor = (key: string | null, id: string, lang: 'ar' | 'en' = 'en', q = '') => Buffer.from(JSON.stringify({ key, id,
  lang, q_hash: createHash('sha256').update(q.trim().toLowerCase()).digest('hex'),
  requested_at: new Date(occurred_at).toISOString(), effective_at: new Date(occurred_at).toISOString(),
  scope_hash: createHash('sha256').update(JSON.stringify([f.company, f.business, f.branch])).digest('hex') })).toString('base64url');

it('record-only access yields exact private-field-free pages, stable cursors with name ties, and no writes', async () => {
  f.h.calls.statements.length = 0;
  const first = await get('lang=ar&limit=2&q=zulu'); expect(first.status).toBe(200);
  const page = sessionPerformerOptionPage.parse(first.body);
  expect(page).toEqual({ items: f.employees.slice(0, 2).map((id) => ({ id, name_ar: 'باء', name_en: 'ZULU', employee_number: null,
    not_clocked_in_warning: true, approved_leave_warning: false })), next_cursor: null });
  const last = sessionPerformerOptionPage.parse((await get(`lang=ar&limit=2&cursor=${cursor('باء', must(f.employees[1]), 'ar')}`)).body);
  expect(last.items.map((r) => r.id)).toEqual([f.employees[2]]); expect(last.next_cursor).toBeNull();
  expect((await get(`lang=ar&cursor=${cursor('ياء', must(f.employees[2]), 'ar')}`)).body).toEqual({ items: [], next_cursor: null });
  expect((await get('limit=4')).body['next_cursor']).toBeNull();
  expect(f.h.calls.statements.every(({ sql: statement }) => !/\b(INSERT|UPDATE|DELETE)\b/i.test(statement))).toBe(true);
  expect((await f.h.send('GET', `${f.base}?date=2026-10-14`, { cookie: f.cookie, company: f.company })).status).toBe(403);
});
it('pages globally by the displayed ICU name and id without gaps or duplicates', async () => {
  for (const [lang, order] of [['ar', [3, 0, 1, 2]], ['en', [2, 3, 0, 1]]] as const) {
    const found: string[] = []; let next: string | null = null;
    for (let page = 0; page < 4; page++) {
      const result = sessionPerformerOptionPage.parse((await get(`lang=${lang}&limit=1${next === null ? '' : `&cursor=${next}`}`)).body);
      found.push(...result.items.map((r) => r.id)); next = result.next_cursor;
      expect(next === null).toBe(page === 3);
    }
    expect(found).toEqual(order.map((i) => f.employees[i]));
  }
});
it('searches either name case-insensitively after trimming before cursor pagination', async () => {
  for (const lang of ['ar', 'en'] as const) for (const q of ['zUlU', '  باء  ']) {
    const page = sessionPerformerOptionPage.parse((await get(`lang=${lang}&limit=1&q=${encodeURIComponent(q)}`)).body);
    expect(page.items.map((r) => r.id)).toEqual([f.employees[0]]); expect(page.next_cursor).toBe(cursor(lang === 'ar' ? 'باء' : 'ZULU', must(f.employees[0]), lang, q));
    const last = sessionPerformerOptionPage.parse((await get(`lang=${lang}&limit=1&q=${encodeURIComponent(q)}&cursor=${page.next_cursor}`)).body);
    expect(last.items.map((r) => r.id)).toEqual([f.employees[1]]); expect(last.next_cursor).toBeNull();
  }
  for (const q of ['absent', '%', '_']) expect((await get(`q=${q}`)).body).toEqual({ items: [], next_cursor: null });
  const malformed = ['bad', cursor('a', 'bad'), cursor(null, must(f.employees[0])), cursor('\u0000', must(f.employees[0])),
    cursor('a'.repeat(1025), must(f.employees[0])), Buffer.from('{').toString('base64url'), Buffer.from(JSON.stringify({ key: 'a', id: f.employees[0], extra: 1 })).toString('base64url'),
    cursor('a', must(f.employees[0])) + '=', 'Zh', Buffer.from([0xff]).toString('base64url')];
  for (const value of malformed) expect((await get(`cursor=${encodeURIComponent(value)}`)).status).toBe(400);
  for (const query of ['limit=0', 'limit=101', 'q=', 'q=%20', `q=${'a'.repeat(51)}`, 'user_id=bad', 'lang=', 'lang=AR', 'lang=fr']) expect((await get(query)).status).toBe(400);
  for (const query of ['', 'occurred_at=bad', `occurred_at=${occurred_at}`, 'lang=en']) expect((await f.h.send('GET', `${f.base}/performer-options?${query}`, { cookie: f.cookie, company: f.company })).status).toBe(400);
});
it('rejects NUL in search with 400 before PostgreSQL text normalization', async () => {
  f.h.calls.statements.length = 0;
  for (const q of ['%00', 'Zulu%00', '%00Zulu']) {
    const result = await get(`q=${q}`); expect(result.status).toBe(400); expect(result.body['code']).toBe('VALIDATION_FAILED');
  }
  expect(f.h.calls.statements.some(({ sql: statement }) => statement.includes('AS normalized_q'))).toBe(false);
});
it('binds cursors to the selected company, business and branch even for authorized target scopes', async () => {
  const page = sessionPerformerOptionPage.parse((await get('limit=1', f.ownerCookie)).body);
  const next = must(page.next_cursor);
  expect(JSON.parse(Buffer.from(next, 'base64url').toString('utf8')).scope_hash)
    .toBe(createHash('sha256').update(JSON.stringify([f.company, f.business, f.branch])).digest('hex'));
  expect((await get(`limit=1&cursor=${next}`, f.ownerCookie)).status).toBe(200);
  for (const [cookie, company, business, branch] of [[f.ownerCookie, f.company, f.business, sibling],
    [f.ownerCookie, f.company, f.secondBusiness, f.secondBranch], [f.cookie, f.otherCompany, f.foreignBusiness, f.foreignBranch]]) {
    const base = `/v1/businesses/${business}/branches/${branch}/service-sessions`;
    expect((await get('limit=1', must(cookie), must(company), base)).status).toBe(200);
    const replay = await get(`limit=1&cursor=${next}`, must(cookie), must(company), base);
    expect(replay.status).toBe(400); expect(replay.body['code']).toBe('VALIDATION_FAILED');
  }
});
it('binds cursors to language and normalized search, refusing changed or removed search', async () => {
  const page = sessionPerformerOptionPage.parse((await get('lang=en&limit=1&q=%20ZuLu%20')).body);
  for (const query of ['lang=ar&q=zulu', 'lang=en&q=Alpha', 'lang=en'])
    expect((await get(`${query}&cursor=${page.next_cursor}`)).status).toBe(400);
  expect(sessionPerformerOptionPage.parse((await get(`lang=en&q=ZULU&cursor=${page.next_cursor}`)).body).items.map((r) => r.id))
    .toEqual([f.employees[1]]);
});
it('binds cursors to the canonical requested instant, refusing a different instant on the same day', async () => {
  const at = (instant: string, next?: string) => f.h.send('GET', `${f.base}/performer-options?lang=en&limit=1&occurred_at=${encodeURIComponent(instant)}${next === undefined ? '' : `&cursor=${next}`}`,
    { cookie: f.cookie, company: f.company });
  await f.h.owner`UPDATE branches SET timezone='America/New_York' WHERE company_id=${f.company} AND id=${f.branch}`;
  try {
    const first = await at('2026-10-14T01:30:00Z'); expect(first.status).toBe(200);
    const next = must(sessionPerformerOptionPage.parse(first.body).next_cursor);
    expect(JSON.parse(Buffer.from(next, 'base64url').toString('utf8'))).toMatchObject({
      requested_at: '2026-10-14T01:30:00.000Z', effective_at: '2026-10-14T01:30:00.000Z' });
    const same = await at('2026-10-13T21:30:00-04:00', next); expect(same.status).toBe(200);
    expect(sessionPerformerOptionPage.parse(same.body).items.map((r) => r.id)).toEqual([f.employees[3]]);
    expect((await at('2026-10-14T02:30:00Z', next)).status).toBe(400);
    expect((await at('2026-10-14T04:00:00Z', next)).status).toBe(400);
  } finally {
    f.setAt(AT);
    await f.h.owner`UPDATE branches SET timezone=NULL WHERE company_id=${f.company} AND id=${f.branch}`;
  }
});
it('pins a tolerated future instant and partial-leave facts across pages, rechecking its effective window', async () => {
  const leaves = [ids.newId(), ids.newId()];
  const requested = '2026-10-14T04:00:30Z';
  const at = (next?: string) => f.h.send('GET', `${f.base}/performer-options?lang=en&limit=1&occurred_at=${requested}${next === undefined ? '' : `&cursor=${next}`}`,
    { cookie: f.cookie, company: f.company });
  await f.h.owner`UPDATE branches SET timezone='America/New_York' WHERE company_id=${f.company} AND id=${f.branch}`;
  try {
    for (const [i, id] of leaves.entries())
      await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
        VALUES(${f.company},${id},${f.business},${f.branch},${must(f.employees[i + 2])},'PARTIAL','2026-10-14','2026-10-14','00:00','01:00','America/New_York',
          '2026-10-14T04:00:00Z','2026-10-14T05:00:00Z','ANNUAL','APPROVED',${f.userId},now(),${f.ownerId},now())`;
    f.setAt(new Date('2026-10-14T03:59:30Z'));
    const first = await at(); expect(first.status).toBe(200);
    const page = sessionPerformerOptionPage.parse(first.body);
    expect(page.items[0]).toMatchObject({ id: f.employees[2], approved_leave_warning: false });
    const next = must(page.next_cursor);
    const instants = { requested_at: '2026-10-14T04:00:30.000Z', effective_at: '2026-10-14T03:59:30.000Z' };
    expect(JSON.parse(Buffer.from(next, 'base64url').toString('utf8'))).toMatchObject(instants);
    f.setAt(new Date('2026-10-14T04:00:00Z'));
    const later = await at(next); expect(later.status).toBe(200);
    const continued = sessionPerformerOptionPage.parse(later.body);
    expect(continued.items[0]).toMatchObject({ id: f.employees[3], approved_leave_warning: false });
    expect(JSON.parse(Buffer.from(must(continued.next_cursor), 'base64url').toString('utf8'))).toMatchObject(instants);
    expect(sessionPerformerOptionPage.parse((await at()).body).items[0]?.approved_leave_warning).toBe(true);
    f.setAt(new Date('2026-12-01T08:00:00Z'));
    const expired = await at(next); expect(expired.status).toBe(400); expect(expired.body['code']).toBe('SESSION_TIME_TOO_OLD');
  } finally {
    for (const id of leaves) await f.h.owner`UPDATE leave_requests SET status='CANCELLED',revoked_by=${f.ownerId},revoked_at='2026-10-14T03:00:00Z',revocation_reason='Synthetic cleanup' WHERE company_id=${f.company} AND id=${id}`;
    f.setAt(AT);
    await f.h.owner`UPDATE branches SET timezone=NULL WHERE company_id=${f.company} AND id=${f.branch}`;
  }
});
it('folds non-ASCII search with ICU and pages literal percent, underscore and backslash matches', async () => {
  await f.h.owner`UPDATE employees SET name_en=${'ÉLÈNE%_\\'} WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
  await f.h.owner`UPDATE employees SET name_ar=${'ÉLÈNE%_\\'} WHERE company_id=${f.company} AND id=${must(f.employees[1])}`;
  try {
    for (const lang of ['ar', 'en'] as const) for (const q of ['élè', '%', '_', '\\', '%_\\']) {
      const order = lang === 'ar' ? [f.employees[1], f.employees[0]] : f.employees.slice(0, 2);
      const first = await get(`lang=${lang}&limit=1&q=${encodeURIComponent(q)}`); expect(first.status).toBe(200);
      const page = sessionPerformerOptionPage.parse(first.body); expect(page.items.map((r) => r.id)).toEqual(order.slice(0, 1));
      const payload = JSON.parse(Buffer.from(must(page.next_cursor), 'base64url').toString('utf8'));
      const normalized = await f.db.withTenant(f.company, (tx) => tx.execute<{ value: string }>(sql`SELECT lower(${q}::text COLLATE "und-x-icu") AS value`));
      expect(payload.q_hash).toBe(createHash('sha256').update(must(normalized[0]).value).digest('hex'));
      const last = await get(`lang=${lang}&limit=1&q=${encodeURIComponent(q.toUpperCase())}&cursor=${page.next_cursor}`); expect(last.status).toBe(200);
      expect(sessionPerformerOptionPage.parse(last.body)).toMatchObject({ items: [{ id: order[1] }], next_cursor: null });
    }
  } finally {
    await f.h.owner`UPDATE employees SET name_en='ZULU' WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
    await f.h.owner`UPDATE employees SET name_ar='باء' WHERE company_id=${f.company} AND id=${must(f.employees[1])}`;
  }
});
it('uses the POST window in business timezone, accepts both edges and normalizes future tolerance', async () => {
  const now = new Date('2026-10-31T21:30:00.000Z');
  const at = (occurredAt: string) => f.h.send('GET', `${f.base}/performer-options?lang=en&occurred_at=${occurredAt}`, { cookie: f.cookie, company: f.company });
  f.setAt(now);
  await f.h.owner`UPDATE branches SET timezone='America/New_York' WHERE company_id=${f.company} AND id=${f.branch}`;
  try {
    await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
      VALUES(${f.company},${ids.newId()},${f.business},${f.branch},${must(f.employees[0])},'PARTIAL','2026-10-31','2026-10-31','17:31','18:00','America/New_York',
        '2026-10-31T21:31:00Z','2026-10-31T22:00:00Z','ANNUAL','APPROVED',${f.userId},now(),${f.ownerId},now())`;
    for (const [instant, code] of [[new Date(now.getTime() + 120001).toISOString(), 'SESSION_TIME_IN_FUTURE'],
      ['2026-09-30T20:59:59.999Z', 'SESSION_TIME_TOO_OLD']]) {
      const result = await at(must(instant)); expect(result.status).toBe(400); expect(result.body['code']).toBe(code);
      await expect(ordersPerformerOptionsQuery(f.db, f.clock).execute(f.context(), { occurred_at: must(instant), lang: 'en', limit: 20 })).rejects.toMatchObject({ code });
    }
    expect((await at('2026-09-30T21:00:00.000Z')).status).toBe(200);
    const current = await at(now.toISOString()); expect(current.status).toBe(200);
    expect(sessionPerformerOptionPage.parse(current.body).items.every((r) => !r.approved_leave_warning)).toBe(true);
    const edge = await at(new Date(now.getTime() + 120000).toISOString()); expect(edge.status).toBe(200); expect(edge.body).toEqual(current.body);
  } finally {
    f.setAt(AT);
    await f.h.owner`UPDATE branches SET timezone=NULL WHERE company_id=${f.company} AND id=${f.branch}`;
  }
});
it('provider respects real RLS, business and dated branch links; cannot enumerate another scope', async () => {
  expect((await f.db.withTenant(f.company, (tx) => sessionPerformerOptions(tx, f.company, f.secondBusiness, f.secondBranch,
    { occurred_at, lang: 'en', limit: 20 }, (instant) => instant))).items).toHaveLength(1);
  for (const [company, business, branch] of [[f.company, f.business, sibling], [f.otherCompany, f.foreignBusiness, f.foreignBranch]])
    expect(await f.db.withTenant(f.company, (tx) => sessionPerformerOptions(tx, must(company), must(business), must(branch), { occurred_at, lang: 'en', limit: 20 }, (instant) => instant)))
      .toEqual({ items: [], next_cursor: null });
  const employee = must(f.employees[3]);
  await f.h.owner`UPDATE employee_branches SET "to"='2026-10-14' WHERE company_id=${f.company} AND employee_id=${employee}`;
  expect(sessionPerformerOptionPage.parse((await get()).body).items.map((r) => r.id)).not.toContain(employee);
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${ids.newId()},${f.business},${employee},${f.branch},'2026-10-14')`;
  for (const [company, base] of [[f.otherCompany, f.base], [f.company, `/v1/businesses/${f.secondBusiness}/branches/${f.branch}/service-sessions`],
    [f.company, `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/service-sessions`]])
    expect((await get(`cursor=${cursor('zulu', employee)}`, f.cookie, must(company), must(base))).status).toBe(403);
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
  await f.h.owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((r) => r.code === 'cashier')).id},ends_at=${AT.toISOString()} WHERE company_id=${f.company} AND id=${f.membership}`;
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
  for (const lang of ['ar', 'en'] as const) for (const after of [undefined, cursor(lang === 'ar' ? 'باء' : 'ZULU', must(f.employees[0]), lang, 'zulu')]) {
    plans.length = 0;
    expect((await ordersPerformerOptionsQuery(db, f.clock).execute(f.context(), { occurred_at, lang, q: 'zulu', limit: 1,
      ...(after === undefined ? {} : { cursor: after }) })).items).toHaveLength(1);
    const plan = plans.join('');
    for (const name of ['employees_', 'employee_branches_', 'memberships_', 'businesses_pkey']) expect(plan).toContain(name);
    expect(plan).not.toContain('Seq Scan');
  }
});
