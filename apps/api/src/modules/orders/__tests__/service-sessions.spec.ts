import { afterAll, beforeAll, expect, it } from 'vitest';
import { appendServiceSessionLinesResponse, recordServiceSessionResponse, serviceSessionRecorded, serviceSessionLinesAdded } from '@pospay/contracts';
import { sessionFixture, ids, must, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });
const post = (body: object, key = ids.newId(), cookie = f.cookie, url = f.base, company = f.company) => f.h.send('POST', url, { cookie, company, key, body });
const httpBody = () => ({ customer_id: f.customer, lines: [f.line()] });

it('35a defaults exactly five system roles and requires admin authentication and Idempotency-Key', async () => {
  const roles = await f.h.owner`SELECT r.code FROM roles r JOIN role_permissions p ON p.role_id=r.id AND p.role_owner_key=r.owner_key
    WHERE p.permission_code='record:service-sessions:branch' AND r.company_id IS NULL ORDER BY r.code`;
  expect(roles.map((r) => r['code'])).toEqual(['branch_manager','business_manager','cashier','general_manager','owner']);
  expect((await f.h.app.inject({ method: 'POST', url: f.base, payload: httpBody() })).statusCode).toBe(401);
  expect((await f.h.app.inject({ method: 'POST', url: f.base, headers: { cookie: f.cookie, 'x-company-id': f.company }, payload: httpBody() })).statusCode).toBe(400);
  const valid = await post(httpBody());
  expect(valid.status).toBe(201);
  expect(recordServiceSessionResponse.parse(valid.body).session.recorded_by_membership_id).toBe(f.membership);
  const uppercase = await post({ customer_id: f.customer.toUpperCase(), recorder_membership_id: f.membership.toUpperCase(),
    lines: [{ ...f.line(), service_id: must(f.services[0]).toUpperCase(), performers: [{ employee_id: must(f.employees[0]).toUpperCase() }] }] }, ids.newId(), f.cookie,
    `/v1/businesses/${f.business.toUpperCase()}/branches/${f.branch.toUpperCase()}/service-sessions`);
  expect(uppercase.status).toBe(201);
});

it('SS-01..05 snapshots multi-line services, rules, shares, warnings and safe customer; one event and audits', async () => {
  const input = f.body([f.line(f.services[0], '25.000', '2.500'), f.line(f.services[3], '15.000')]);
  must(input.lines[1]).performers = [{ employee_id: must(f.employees[1]) }, { employee_id: must(f.employees[2]) }];
  const result = await f.create.execute({ ...f.context(), input });
  expect(recordServiceSessionResponse.safeParse(result).success).toBe(true);
  expect(result.session).toMatchObject({ total_net: '37.500', late: true, business_date: '2026-10-14', business_timezone: 'Asia/Kuwait',
    customer: { id: f.customer, name: 'Synthetic customer', phone_masked: expect.stringContaining('123') } });
  expect(must(result.session.lines[1]).performers.map((p) => p.share_bps)).toEqual([5000,5000]);
  expect(must(result.session.lines[1]).rule_snapshot).toEqual({ kind: 'FIXED', value: '2.500' });
  expect(result.session.lines.every((l) => l.has_performer_warning)).toBe(true);
  const events = await f.h.owner`SELECT event_type,payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${result.session.id}`;
  expect(events).toHaveLength(1);
  expect(must(events[0])['event_type']).toBe('ServiceSessionRecorded');
  expect(serviceSessionRecorded.parse(must(events[0])['payload']).lines).toHaveLength(2);
  expect(JSON.stringify(events)).not.toContain('phone');
  const audits = await f.h.owner`SELECT action,actor_user_id,after FROM audit_log WHERE company_id=${f.company} AND (entity_id=${result.session.id} OR entity_id=${must(result.session.lines[0]).id})`;
  expect(audits.map((a) => a['action']).sort()).toEqual(['session.created','session.price_discount_recorded']);
  expect(audits.every((a) => a['actor_user_id'] === f.userId)).toBe(true);
  expect(JSON.stringify(audits)).not.toContain('phone');
});

it('SS-12/14/22 PARTIAL 201 replays exactly; corrected line appends to the same visit and emits only its delta', async () => {
  const body = { customer_id: f.customer, lines: [f.line(), { ...f.line(f.services[1], '7.125'), discount: { kind: 'PERCENT', bps: 1000 } }] };
  const key = ids.newId();
  const first = await post(body, key);
  expect(first.status).toBe(201);
  const result = recordServiceSessionResponse.parse(first.body);
  expect(result.outcome).toBe('PARTIAL');
  expect(result.session.lines.map((l) => [l.input_index,l.ordinal])).toEqual([[0,1]]);
  expect(result.rejected_lines[0]).toMatchObject({ input_index: 1, discount: '0.713', net: '6.412', effective_discount_bps: 1001, minimum_net: '6.413', max_discount_amount: '0.712' });
  const repeat = await post(body, key);
  expect(repeat.body).toEqual(first.body);
  expect((await post({ ...body, lines: [f.line()] }, key)).status).toBe(422);
  const url = `${f.base}/${result.session.id}/lines`;
  const appendKey = ids.newId();
  const addition = await post({ lines: [f.line(f.services[1], '7.125', '0.712')] }, appendKey, f.cookie, url);
  expect(addition.status).toBe(201);
  const appended = appendServiceSessionLinesResponse.parse(addition.body);
  expect(appended.session.id).toBe(result.session.id);
  expect(appended.session.occurred_at).toBe(result.session.occurred_at);
  expect(appended.session.recorded_at).toBe(result.session.recorded_at);
  expect(appended.session.lines[0]).toEqual(result.session.lines[0]);
  expect(appended.added_lines.map((l) => [l.input_index,l.ordinal])).toEqual([[0,2]]);
  expect(appended.session.total_net).toBe('31.413');
  expect((await post({ lines: [f.line(f.services[1], '7.125', '0.712')] }, appendKey, f.cookie, url)).body).toEqual(addition.body);
  const events = await f.h.owner`SELECT event_type,payload FROM outbox WHERE aggregate_id=${result.session.id} ORDER BY seq`;
  expect(events.map((e) => e['event_type'])).toEqual(['ServiceSessionRecorded','ServiceSessionLinesAdded']);
  expect(serviceSessionLinesAdded.parse(must(events[1])['payload']).lines.map((l) => l.line_id)).toEqual(appended.added_lines.map((l) => l.id));
});

it('SS-11/26 all-over-limit creates no empty visit/claim; any other invalid line aborts the entire request', async () => {
  const count = async () => f.h.owner`SELECT (SELECT count(*) FROM service_sessions) AS sessions,(SELECT count(*) FROM service_lines) AS lines,(SELECT count(*) FROM outbox) AS events,(SELECT count(*) FROM idempotency_keys) AS keys`;
  const before = await count();
  const all = await post({ customer_id: f.customer, lines: [f.line(f.services[0], '25.000', '3.000')] });
  expect(all.status).toBe(422); expect(all.body['code']).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  expect(all.body['details']).toMatchObject({ rejected_lines: [{ input_index: 0 }] });
  const invalid = await post({ customer_id: f.customer, lines: [f.line(), f.line(ids.newId())] });
  expect(invalid.status).toBe(422); expect(invalid.body['code']).toBe('SESSION_SERVICE_NOT_FOUND');
  const shares = await post({ customer_id: f.customer, lines: [f.line(), { ...f.line(), performers: [{ employee_id: f.employees[0], share_bps: 9999 }] }] });
  expect(shares.status).toBe(422); expect(shares.body['code']).toBe('SESSION_PERFORMER_SHARES_INVALID');
  expect(await count()).toEqual(before);
});

it('SS-24/25 uniform scope refusal and owner/cashier self prohibition', async () => {
  expect((await post(httpBody(), ids.newId(), f.cookie, `/v1/businesses/${f.secondBusiness}/branches/${f.branch}/service-sessions`)).status).toBe(403);
  expect((await post(httpBody(), ids.newId(), f.cookie, `/v1/businesses/${f.business}/branches/${ids.newId()}/service-sessions`)).status).toBe(403);
  await f.h.owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
  const result = await post(httpBody()); expect(result.status).toBe(403); expect(result.body['code']).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
  await f.h.owner`UPDATE employees SET user_id=${f.ownerId} WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
  expect((await post(httpBody(), ids.newId(), f.ownerCookie)).body['code']).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
  await f.h.owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
});

it('SS-22 concurrent same key creates one effect; changed actor cannot obtain its replay', async () => {
  const key = ids.newId(), body = httpBody();
  const replies = await Promise.all([post(body,key),post(body,key)]);
  expect(replies.map((r) => r.status)).toEqual([201,201]); expect(must(replies[0]).body).toEqual(must(replies[1]).body);
  const session = recordServiceSessionResponse.parse(must(replies[0]).body).session;
  expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${session.id}`).toHaveLength(1);
  const foreignActor = await post(body, key, f.ownerCookie);
  expect(foreignActor.status).toBe(422); expect(foreignActor.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
});

it('SS-27 multiple memberships require explicit caller-owned selection; foreign selection is 403', async () => {
  const second = ids.newId();
  const [role] = await f.h.owner`SELECT role_id FROM memberships WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps)
    VALUES(${f.company},${second},${f.userId},${must(role)['role_id'] as string},'global','BRANCH',${f.branch},2000)`;
  const ambiguous = await post(httpBody()); expect(ambiguous.status).toBe(400); expect(ambiguous.body['code']).toBe('SESSION_RECORDER_MEMBERSHIP_REQUIRED');
  const selected = await post({ ...httpBody(), recorder_membership_id: second });
  expect(selected.status).toBe(201); expect(recordServiceSessionResponse.parse(selected.body).session.recorded_by_membership_id).toBe(second);
  expect((await post({ ...httpBody(), recorder_membership_id: ids.newId() })).status).toBe(403);
  await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${second}`.catch(async () => {
    await f.h.owner`UPDATE memberships SET ends_at=now() WHERE company_id=${f.company} AND id=${second}`;
  });
});
