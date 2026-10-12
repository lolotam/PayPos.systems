import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import { sessionFixture, ids, must, AT, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });
const create = () => f.create.execute({ ...f.context(), input: f.body() });
const add = (sessionId: string, lines = [f.line()], overrides = {}) => f.append.execute({ ...f.context(), sessionId, input: { lines }, ...overrides });

it('SS-28/29 appender uses their own unlimited/limited authority and membership; original header remains immutable', async () => {
  const first = await create();
  const result = await add(first.session.id, [f.line(f.services[0], '15.000')], { userId: f.ownerId });
  expect(result.added_lines[0]).toMatchObject({ recorded_by: f.ownerId, limit_source: 'OWNER', limit_bps_applied: null, net: '15.000', late: true });
  expect(result.session.recorded_by).toBe(f.userId); expect(result.session.recorded_at).toBe(first.session.recorded_at);
  expect(result.session.customer).toEqual(first.session.customer); expect(result.session.total_net).toBe('40.000');
  expect(result.session.lines[0]).toEqual(first.session.lines[0]);
});

it('SS-29 original recorder can append after losing the record grant, but DENY and active membership still apply to replay', async () => {
  const first = await create();
  const emptyRole = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${emptyRole},${f.company},'synthetic_session_reader','Synthetic')`;
  await f.h.owner`UPDATE memberships SET role_id=${emptyRole},role_owner_key=${f.company} WHERE company_id=${f.company} AND id=${f.membership}`;
  await expect(f.create.execute({ ...f.context(), input: f.body() })).rejects.toThrow('FORBIDDEN');
  const key = ids.newId();
  const added = await add(first.session.id, [f.line()], { key });
  expect(added.added_lines).toHaveLength(1);
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.membership},'record:service-sessions:branch','DENY','BRANCH',${f.branch},'Synthetic deny',${f.ownerId})`;
  await expect(add(first.session.id, [f.line()], { key })).rejects.toThrow('FORBIDDEN');
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
  const cashier = must(SYSTEM_ROLES.find((r) => r.code === 'cashier')).id;
  await f.h.owner`UPDATE memberships SET role_id=${cashier},role_owner_key='global' WHERE company_id=${f.company} AND id=${f.membership}`;
});

it('SS-30 concurrent additions serialize ordinals and the 20 persisted-line capacity; rejected drafts take no slots', async () => {
  const initial = await f.create.execute({ ...f.context(), input: f.body(Array.from({ length: 18 }, () => f.line())) });
  const replies = await Promise.all([add(initial.session.id),add(initial.session.id)]);
  expect(replies.map((r) => must(r.added_lines[0]).ordinal).sort((a,b) => a-b)).toEqual([19,20]);
  await expect(add(initial.session.id)).rejects.toThrow('SESSION_LINE_CAPACITY_EXCEEDED');
  const ordinals = await f.h.owner`SELECT ordinal FROM service_lines WHERE company_id=${f.company} AND session_id=${initial.session.id} ORDER BY ordinal`;
  expect(ordinals.map((r) => r['ordinal'])).toEqual(Array.from({ length: 20 }, (_,i) => i+1));
  expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${initial.session.id}`).toHaveLength(3);
});

it('SS-31 all-rejected append leaves the existing visit/claim/event unchanged; invalid other line aborts additions', async () => {
  const initial = await create(); const key = ids.newId();
  await expect(add(initial.session.id, [f.line(f.services[0], '20.000')], { key })).rejects.toThrow('SESSION_DISCOUNT_ABOVE_LIMIT');
  await expect(add(initial.session.id, [f.line(), f.line(ids.newId())])).rejects.toThrow('SESSION_SERVICE_NOT_FOUND');
  expect(await f.h.owner`SELECT 1 FROM service_lines WHERE session_id=${initial.session.id}`).toHaveLength(1);
  expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${initial.session.id}`).toHaveLength(1);
  expect(await f.h.owner`SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`).toHaveLength(0);
  const result = await add(initial.session.id, [f.line()], { key });
  expect(result.session.lines).toHaveLength(2);
});

it('SS-30 expired back-dating window refuses append while keeping the original business date/timezone', async () => {
  const first = await create(); f.setAt(new Date('2026-12-01T00:00:00Z'));
  await expect(add(first.session.id)).rejects.toThrow('SESSION_TIME_TOO_OLD');
  f.setAt(AT);
  expect(await f.h.owner`SELECT 1 FROM service_lines WHERE session_id=${first.session.id}`).toHaveLength(1);
});

it('SS-16/17 creation normalizes <=120s skew and refuses outside time/window without a claim', async () => {
  const normalized = await f.create.execute({ ...f.context(), input: { ...f.body(), occurred_at: '2026-10-15T08:02:00.000Z' } });
  expect(normalized.session.occurred_at).toBe(AT.toISOString()); expect(normalized.session.late).toBe(false);
  await expect(f.create.execute({ ...f.context(), input: { ...f.body(), occurred_at: '2026-10-15T08:02:00.001Z' } })).rejects.toThrow('SESSION_TIME_IN_FUTURE');
  const boundary = await f.create.execute({ ...f.context(), input: { ...f.body(), occurred_at: '2026-08-31T21:00:00.000Z' } });
  expect(boundary.session.business_date).toBe('2026-09-01');
  await expect(f.create.execute({ ...f.context(), input: { ...f.body(), occurred_at: '2026-08-31T20:59:59.999Z' } })).rejects.toThrow('SESSION_TIME_TOO_OLD');
});

it('SS-18/13 recording reads no commission statement and NOT_CONFIGURED means zero effective discount', async () => {
  await f.h.owner`UPDATE memberships SET limit_bps=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
  await expect(f.create.execute({ ...f.context(), input: f.body([f.line(f.services[0], '24.999')]) })).rejects.toThrow('SESSION_DISCOUNT_ABOVE_LIMIT');
  const free = await f.create.execute({ ...f.context(), input: f.body([f.line(f.services[2], '0.000')]) });
  expect(free.session.lines[0]).toMatchObject({ net: '0.000', limit_source: 'NOT_CONFIGURED', limit_bps_applied: 0 });
  await f.h.owner`UPDATE memberships SET limit_bps=1000 WHERE company_id=${f.company} AND id=${f.membership}`;
  expect(f.h.calls.statements.some((c) => /commission_statements|FROM statements/.test(c.sql))).toBe(false);
});

it('SS-29 unknown/foreign/wrong-route session is uniform 403 and appender self rule applies', async () => {
  const first = await create();
  await expect(add(ids.newId())).rejects.toThrow('FORBIDDEN');
  await expect(add(first.session.id, [f.line()], { branchId: f.secondBranch })).rejects.toThrow('FORBIDDEN');
  await expect(add(first.session.id, [f.line()], { companyId: f.otherCompany, businessId: f.foreignBusiness, branchId: f.foreignBranch })).rejects.toThrow('FORBIDDEN');
  await f.h.owner`UPDATE employees SET user_id=${f.ownerId} WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
  await expect(add(first.session.id, [f.line()], { userId: f.ownerId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
  await f.h.owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
});

it('SS-15 late append records its own late facts without rewriting the original header', async () => {
  const first = await f.create.execute({ ...f.context(), input: { ...f.body(), occurred_at: AT.toISOString() } });
  expect(first.session.late).toBe(false);
  f.setAt(new Date('2026-10-16T08:00:00Z'));
  const result = await add(first.session.id);
  expect(result.session.late).toBe(false); expect(result.added_lines[0]?.late).toBe(true);
  expect(result.added_lines[0]?.recorded_at).toBe('2026-10-16T08:00:00.000Z');
  f.setAt(AT);
});

it('total overflow is atomic for creation and append; maximum KWD still round-trips as decimal', async () => {
  const maximum = '99999999999.999';
  await expect(f.create.execute({ ...f.context(), input: f.body([f.line(f.services[0], maximum),f.line()]) })).rejects.toThrow('SESSION_TOTAL_TOO_LARGE');
  const first = await f.create.execute({ ...f.context(), input: f.body([f.line(f.services[0], maximum)]) });
  expect(first.session.total_net).toBe(maximum);
  await expect(add(first.session.id)).rejects.toThrow('SESSION_TOTAL_TOO_LARGE');
  expect(await f.h.owner`SELECT 1 FROM service_lines WHERE session_id=${first.session.id}`).toHaveLength(1);
});

it('delegated staff admin can record another performer; DENY and disabled/expired feature are checked at the fresh instant', async () => {
  const staff = must(SYSTEM_ROLES.find((r) => r.code === 'staff')).id;
  const cashier = must(SYSTEM_ROLES.find((r) => r.code === 'cashier')).id;
  await f.h.owner`UPDATE memberships SET role_id=${staff} WHERE company_id=${f.company} AND id=${f.membership}`;
  await expect(f.create.execute({ ...f.context(), input: f.body() })).rejects.toThrow('FORBIDDEN');
  const grant = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${grant},${f.membership},'record:service-sessions:branch','ALLOW','BRANCH',${f.branch},'Synthetic delegation',${f.ownerId})`;
  expect((await create()).session.recorded_by).toBe(f.userId);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic feature',${f.ownerId})`;
  await expect(create()).rejects.toThrow('FEATURE_DISABLED');
  await f.h.owner`UPDATE company_feature_overrides SET expires_at='2026-10-15T07:59:59Z' WHERE company_id=${f.company} AND flag='orders'`;
  expect((await create()).session.lines).toHaveLength(1);
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${grant}`;
  await f.h.owner`UPDATE memberships SET role_id=${cashier} WHERE company_id=${f.company} AND id=${f.membership}`;
});
