import { SYSTEM_ROLES, type TenantWrappers } from '@pospay/db';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { ApiError } from '../../../shared/errors.ts';
import { ordersTransactions } from '../orders.module.ts';
import { createSessionRecovery, recoveryKeyHash } from '../persistence/session-recovery.adapter.ts';
import { AppendServiceSessionLinesUseCase } from '../use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import { RecordServiceSessionUseCase } from '../use-cases/record-service-session/record-service-session.usecase.ts';
import { AT, ids, interceptDatabase, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterEach(() => { f?.setAt(AT); });
afterAll(async () => { await f?.close(); });

const hash = recoveryKeyHash;
const plus = (hours: number) => new Date(AT.getTime() + hours * 3_600_000);
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : value;
async function proof(key: string, branchId = f.branch, operation = 'record-service-session') {
  const [row] = await f.h.owner`SELECT to_char(business_date,'YYYY-MM-DD') AS business_date, session_id, committed_at,
    issued_at, last_seen_at, expires_at, revoked_at, revoked_outcome
    FROM service_session_recoveries WHERE company_id=${f.company} AND branch_id=${branchId} AND operation=${operation} AND key_hash=${hash(key)}`;
  return row;
}
function writer(database: TenantWrappers) {
  const recovery = createSessionRecovery(database, ids, f.clock);
  const transactions = ordersTransactions(database, ids, f.clock);
  return {
    record: new RecordServiceSessionUseCase(transactions, recovery, ids, f.clock),
    append: new AppendServiceSessionLinesUseCase(transactions, recovery, ids, f.clock),
  };
}
async function cashierOn(branchId: string) {
  const membership = ids.newId();
  const cashier = must(SYSTEM_ROLES.find((role) => role.code === 'cashier')).id;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps)
    VALUES(${f.company},${membership},${f.userId},${cashier},'global','BRANCH',${branchId},1000)`;
  await f.h.owner`UPDATE memberships SET starts_at='2026-01-01T00:00:00Z' WHERE company_id=${f.company} AND id=${membership}`;
  return membership;
}

it('issues the proof insert before the business session insert', async () => {
  const seen: string[] = [];
  const wrapped = interceptDatabase(f.db, async (statement) => { seen.push(statement); });
  await writer(wrapped).record.execute({ ...f.context(), input: f.body() });
  const proofAt = seen.findIndex((statement) => statement.includes('INSERT INTO service_session_recoveries'));
  const sessionAt = seen.findIndex((statement) => statement.includes('INSERT INTO service_sessions('));
  expect(proofAt).toBeGreaterThanOrEqual(0);
  expect(sessionAt).toBeGreaterThan(proofAt);
});

it('writes nothing and returns 503 when the proof insert is refused', async () => {
  const key = ids.newId();
  await f.h.owner`REVOKE INSERT ON service_session_recoveries FROM pospay_app`;
  try {
    const error = await f.create.execute({ ...f.context(key), input: f.body() }).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'SESSION_RECOVERY_UNAVAILABLE' });
    expect((error as ApiError).status).toBe(503);
    expect(await proof(key)).toBeUndefined();
    expect(await f.h.owner`SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`).toHaveLength(0);
  } finally {
    await f.h.owner`GRANT INSERT ON service_session_recoveries TO pospay_app`;
  }
});

it('extends a live proof on replay and holds the 168 hour cap', async () => {
  const key = ids.newId();
  const input = f.body();
  await f.create.execute({ ...f.context(key), input });
  expect(iso(must(await proof(key))?.['expires_at'])).toBe(plus(72).toISOString());
  for (const [hours, expiry, seen] of [[50, 122, 50], [100, 168, 100], [120, 168, 120], [169, 168, 120]] as const) {
    f.setAt(plus(hours));
    await f.create.execute({ ...f.context(key), input });
    const row = must(await proof(key));
    expect(iso(row['expires_at'])).toBe(plus(expiry).toISOString());
    expect(iso(row['last_seen_at'])).toBe(plus(seen).toISOString());
  }
});

it('leaves an expired or revoked proof unchanged while the write still replays', async () => {
  const expiredKey = ids.newId();
  const expiredVisit = await f.create.execute({ ...f.context(expiredKey), input: f.body() });
  await f.h.owner`UPDATE service_session_recoveries SET expires_at=issued_at + interval '1 hour' WHERE key_hash=${hash(expiredKey)}`;
  f.setAt(plus(2));
  expect((await f.create.execute({ ...f.context(expiredKey), input: f.body() })).session.id).toBe(expiredVisit.session.id);
  expect(iso(must(await proof(expiredKey))?.['expires_at'])).toBe(plus(1).toISOString());
  expect(iso(must(await proof(expiredKey))?.['last_seen_at'])).toBe(AT.toISOString());
  f.setAt(AT);
  const revokedKey = ids.newId();
  await f.create.execute({ ...f.context(revokedKey), input: f.body() });
  await f.h.owner`UPDATE service_session_recoveries SET revoked_at=${plus(1)}, revoked_outcome='NOT_RECORDED' WHERE key_hash=${hash(revokedKey)}`;
  f.setAt(plus(2));
  await f.create.execute({ ...f.context(revokedKey), input: f.body() });
  const revoked = must(await proof(revokedKey));
  expect(iso(revoked['revoked_at'])).toBe(plus(1).toISOString());
  expect(revoked['revoked_outcome']).toBe('NOT_RECORDED');
  expect(iso(revoked['last_seen_at'])).toBe(AT.toISOString());
});

it('returns the stored session after the month boundary without reopening the proof', async () => {
  const key = ids.newId();
  const first = await f.create.execute({ ...f.context(key), input: f.body() });
  const issued = iso(must(await proof(key))?.['expires_at']);
  f.setAt(new Date('2026-12-01T00:00:00.000Z'));
  expect((await f.create.execute({ ...f.context(key), input: f.body() })).session.id).toBe(first.session.id);
  expect(iso(must(await proof(key))?.['expires_at'])).toBe(issued);
});

it('keeps proof date D when the commit crosses branch midnight onto a D+1 session', async () => {
  let calls = 0;
  const wrapped: TenantWrappers = { ...f.db, withTenant: (company, work, options) => {
    calls += 1;
    if (calls === 2) f.setAt(new Date('2026-10-14T21:30:00.000Z'));
    return f.db.withTenant(company, work, options);
  } };
  f.setAt(new Date('2026-10-14T20:30:00.000Z'));
  const key = ids.newId();
  const result = await writer(wrapped).record.execute({ ...f.context(key), input: { customer_id: f.customer, lines: [f.line()] } });
  expect(result.session.business_date).toBe('2026-10-15');
  const row = must(await proof(key));
  expect(row['business_date']).toBe('2026-10-14');
  expect(row['session_id']).toBe(result.session.id);
  expect(row['committed_at']).not.toBeNull();
});

it('dates a new proof from a hand-set occurred_at', async () => {
  const key = ids.newId();
  const result = await f.create.execute({ ...f.context(key), input: { ...f.body(), occurred_at: '2026-10-10T08:00:00.000Z' } });
  expect(result.session.business_date).toBe('2026-10-10');
  expect(must(await proof(key))?.['business_date']).toBe('2026-10-10');
});

it('stores the target session date on an append and leaves committed_at empty when the handler refuses', async () => {
  const created = await f.create.execute({ ...f.context(), input: { ...f.body(), occurred_at: '2026-10-10T08:00:00.000Z' } });
  const key = ids.newId();
  const added = await f.append.execute({ ...f.context(key), sessionId: created.session.id, input: { lines: [f.line()] } });
  const linked = must(await proof(key, f.branch, 'append-service-session-lines'));
  expect(linked['business_date']).toBe('2026-10-10');
  expect(linked['session_id']).toBe(added.session.id);
  expect(linked['committed_at']).not.toBeNull();
  const refused = ids.newId();
  await expect(f.append.execute({ ...f.context(refused), sessionId: created.session.id, input: { lines: [f.line(ids.newId())] } })).rejects.toThrow('SESSION_SERVICE_NOT_FOUND');
  const row = must(await proof(refused, f.branch, 'append-service-session-lines'));
  expect(row['session_id']).toBe(created.session.id);
  expect(row['committed_at']).toBeNull();
});

it('writes no append proof outside the branch or the window', async () => {
  const created = await f.create.execute({ ...f.context(), input: f.body() });
  const membership = await cashierOn(f.secondBranch);
  const outside = ids.newId();
  try {
    await expect(f.append.execute({ ...f.context(outside), businessId: f.secondBusiness, branchId: f.secondBranch, sessionId: created.session.id,
      input: { lines: [f.line()], recorder_membership_id: membership } })).rejects.toThrow('FORBIDDEN');
    expect(await proof(outside, f.secondBranch, 'append-service-session-lines')).toBeUndefined();
  } finally {
    await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${membership}`;
  }
  await f.h.owner`UPDATE service_sessions SET business_date='2026-08-01' WHERE company_id=${f.company} AND id=${created.session.id}`;
  const stale = ids.newId();
  await expect(f.append.execute({ ...f.context(stale), sessionId: created.session.id, input: { lines: [f.line()] } })).rejects.toThrow('SESSION_TIME_TOO_OLD');
  expect(await proof(stale, f.branch, 'append-service-session-lines')).toBeUndefined();
});

it('lets the original recorder append after losing record, and refuses their create with no proof', async () => {
  const created = await f.create.execute({ ...f.context(), input: f.body() });
  const staff = must(SYSTEM_ROLES.find((role) => role.code === 'staff')).id;
  const cashier = must(SYSTEM_ROLES.find((role) => role.code === 'cashier')).id;
  await f.h.owner`UPDATE memberships SET role_id=${staff} WHERE company_id=${f.company} AND id=${f.membership}`;
  try {
    const denied = ids.newId();
    await expect(f.create.execute({ ...f.context(denied), input: f.body() })).rejects.toThrow('FORBIDDEN');
    expect(await proof(denied)).toBeUndefined();
    const key = ids.newId();
    await f.append.execute({ ...f.context(key), sessionId: created.session.id, input: { lines: [f.line()] } });
    expect(must(await proof(key, f.branch, 'append-service-session-lines'))?.['session_id']).toBe(created.session.id);
  } finally {
    await f.h.owner`UPDATE memberships SET role_id=${cashier}, role_owner_key='global' WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});

it('writes no proof when issue refuses the time, and keeps an unlinked proof when the business write refuses', async () => {
  const future = ids.newId();
  await expect(f.create.execute({ ...f.context(future), input: { ...f.body(), occurred_at: '2026-10-15T08:03:00.000Z' } })).rejects.toThrow('SESSION_TIME_IN_FUTURE');
  expect(await proof(future)).toBeUndefined();
  const old = ids.newId();
  await expect(f.create.execute({ ...f.context(old), input: { ...f.body(), occurred_at: '2026-08-01T08:00:00.000Z' } })).rejects.toThrow('SESSION_TIME_TOO_OLD');
  expect(await proof(old)).toBeUndefined();
  const missing = ids.newId();
  await expect(f.create.execute({ ...f.context(missing), input: { ...f.body(), customer_id: ids.newId() } })).rejects.toThrow('SESSION_CUSTOMER_NOT_FOUND');
  const row = must(await proof(missing));
  expect(row['session_id']).toBeNull();
  expect(row['committed_at']).toBeNull();
});

it('gives the same key in another branch its own proof', async () => {
  const key = ids.newId();
  const first = await f.create.execute({ ...f.context(key), input: f.body() });
  const membership = await cashierOn(f.secondBranch);
  try {
    const replay = await f.create.execute({ ...f.context(key), businessId: f.secondBusiness, branchId: f.secondBranch,
      input: { ...f.body(), recorder_membership_id: membership } });
    expect(replay.session.id).toBe(first.session.id);
    const other = must(await proof(key, f.secondBranch));
    expect(other['session_id']).toBeNull();
    expect(other['committed_at']).toBeNull();
    expect(must(await proof(key))?.['session_id']).toBe(first.session.id);
  } finally {
    await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${membership}`;
  }
});

it('links a proof issued after the commit when the stored response is replayed', async () => {
  const key = ids.newId();
  const first = await f.create.execute({ ...f.context(key), input: f.body() });
  const before = await f.h.owner`SELECT id FROM service_sessions WHERE company_id=${f.company}`;
  await f.h.owner`DELETE FROM service_session_recoveries WHERE company_id=${f.company} AND key_hash=${hash(key)}`;
  const replay = await f.create.execute({ ...f.context(key), input: f.body() });
  expect(replay.session.id).toBe(first.session.id);
  const row = must(await proof(key));
  expect(row['session_id']).toBe(first.session.id);
  expect(row['committed_at']).not.toBeNull();
  expect(await f.h.owner`SELECT id FROM service_sessions WHERE company_id=${f.company}`).toHaveLength(before.length);
});

it('links nothing when the stored response has no session', async () => {
  const key = ids.newId();
  await f.h.owner`INSERT INTO idempotency_keys(scope_type,scope_id,company_id,user_id,operation,key,request_fingerprint,response_status,response_body,expires_at)
    VALUES('COMPANY',${f.company},${f.company},${f.userId},'record-service-session',${key},${'a'.repeat(64)},201,
      ${f.h.owner.json({ outcome: 'PARTIAL', rejected_lines: [] })}, now() + interval '24 hours')`;
  await f.create.execute({ ...f.context(key), input: f.body() });
  const row = must(await proof(key));
  expect(row['session_id']).toBeNull();
  expect(row['committed_at']).toBeNull();
});

it('authorize writes no proof', async () => {
  const created = await f.create.execute({ ...f.context(), input: f.body() });
  const before = await f.h.owner`SELECT id FROM service_session_recoveries WHERE company_id=${f.company}`;
  await f.append.authorize({ ...f.context(), sessionId: created.session.id });
  expect(await f.h.owner`SELECT id FROM service_session_recoveries WHERE company_id=${f.company}`).toHaveLength(before.length);
});
