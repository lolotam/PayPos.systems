import { afterAll, beforeAll, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { RecordServiceSessionUseCase } from '../use-cases/record-service-session/record-service-session.usecase.ts';
import { AppendServiceSessionLinesUseCase } from '../use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import { ordersTransactions } from '../orders.module.ts';
import { sessionFixture, ids, must, AT, interceptDatabase, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });
async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await delay(10); }
  throw new Error('Expected database wait did not occur');
}
async function catalogHold() {
  const gate = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  await f.h.owner.unsafe(`CREATE OR REPLACE FUNCTION test_catalog_hold() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(hashtext('test:orders:catalog-patch')); RETURN NEW; END $$`);
  await f.h.owner.unsafe(`CREATE TRIGGER test_catalog_hold BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION test_catalog_hold()`);
  await gate`SELECT pg_advisory_lock(hashtext('test:orders:catalog-patch'))`;
  return { release: () => gate`SELECT pg_advisory_unlock(hashtext('test:orders:catalog-patch'))`, close: async () => {
    await gate`SELECT pg_advisory_unlock_all()`; await gate.end();
    await f.h.owner.unsafe('DROP TRIGGER test_catalog_hold ON services'); await f.h.owner.unsafe('DROP FUNCTION test_catalog_hold()');
  } };
}
function patch(serviceId: string, price: string, revision: number) {
  return f.h.app.inject({ method: 'PATCH', url: `/v1/businesses/${f.business}/services/${serviceId}`,
    headers: { cookie: f.ownerCookie, 'x-company-id': f.company }, payload: { expected_revision: revision, name_en: 'Synthetic edited', name_ar: null,
      price, commission_rule: { kind: 'FOLLOW_PLAN' }, counts_toward_threshold: true } });
}
async function waitingService() {
  const rows = await f.h.owner`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM services%'`;
  return rows.length > 0;
}

it('ADR-0041 actual catalog PATCH/audit completes while create holds company SHARE and waits for service SHARE', async () => {
  const gate = await catalogHold();
  try {
    const editing = patch(must(f.services[0]), '26.000', 1);
    await waitFor(async () => (await f.h.owner`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted`).length > 0);
    const recording = f.create.execute({ ...f.context(), input: f.body() });
    await waitFor(waitingService);
    await gate.release();
    expect((await editing).statusCode).toBe(200);
    const result = await recording;
    expect(result.session.lines[0]).toMatchObject({ list_price: '26.000', catalog_revision: 2 });
    expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${result.session.id}`).toHaveLength(1);
  } finally { await gate.close(); }
});

it('ADR-0041 append waiting on real catalog PATCH uses a fresh consistent snapshot; reversed service input locks do not deadlock', async () => {
  const first = await f.create.execute({ ...f.context(), input: f.body() });
  const gate = await catalogHold();
  try {
    const editing = patch(must(f.services[0]), '27.000', 2);
    await waitFor(async () => (await f.h.owner`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted`).length > 0);
    const input = { lines: [f.line(f.services[1], '7.125'), f.line()] };
    const appending = f.append.execute({ ...f.context(), sessionId: first.session.id, input });
    const recording = f.create.execute({ ...f.context(), input: f.body([...input.lines].reverse()) });
    await waitFor(waitingService); await gate.release();
    expect((await editing).statusCode).toBe(200);
    const [added, recorded] = await Promise.all([appending,recording]);
    expect(added.added_lines.find((l) => l.service_id === f.services[0])?.list_price).toBe('27.000');
    expect(recorded.session.lines.find((l) => l.service_id === f.services[0])?.catalog_revision).toBe(3);
    expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${first.session.id}`).toHaveLength(2);
  } finally { await gate.close(); }
});

it.each(['service_sessions','service_lines','line_performers','audit_log','outbox','idempotency_keys'])('failure at %s rolls back accepted effects and claim; retry then succeeds', async (table) => {
  const key = ids.newId();
  const snapshot = () => f.h.owner`SELECT (SELECT count(*) FROM service_sessions) AS sessions,(SELECT count(*) FROM service_lines) AS lines,
    (SELECT count(*) FROM line_performers) AS performers,(SELECT count(*) FROM audit_log) AS audit,(SELECT count(*) FROM outbox) AS events,(SELECT count(*) FROM idempotency_keys) AS keys`;
  const before = await snapshot();
  const wrapped = interceptDatabase(f.db, async (statement) => {
    if (table === 'idempotency_keys' ? /UPDATE idempotency_keys/.test(statement) : statement.includes(`INSERT INTO ${table}`))
      throw new Error('Synthetic driver statement and params must not escape');
  });
  const create = new RecordServiceSessionUseCase(ordersTransactions(wrapped, ids), ids, f.clock);
  await expect(create.execute({ ...f.context(key), input: f.body() })).rejects.toThrow('SESSION_PERSISTENCE_FAILED');
  expect(await snapshot()).toEqual(before);
  const result = await f.create.execute({ ...f.context(key), input: f.body() });
  expect(result.session.lines).toHaveLength(1);
});

it('fresh clock after service lock wait rejects an expired membership and an append outside its window', async () => {
  const blocker = f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SELECT id FROM services WHERE company_id=${f.company} AND id=${must(f.services[0])} FOR UPDATE`);
    await waitFor(async () => {
      const rows = await f.h.owner`SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM services%' AND datname=current_database()`;
      return rows.length > 0;
    });
    f.setAt(new Date('2026-10-15T08:00:02Z'));
  });
  await f.h.owner`UPDATE memberships SET ends_at='2026-10-15T08:00:01Z' WHERE company_id=${f.company} AND id=${f.membership}`;
  const recording = f.create.execute({ ...f.context(), input: f.body() });
  await blocker;
  await expect(recording).rejects.toThrow('FORBIDDEN');
  await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
  f.setAt(AT);
  const visit = await f.create.execute({ ...f.context(), input: { ...f.body(), occurred_at: '2026-09-01T08:00:00Z' } });
  let entered: () => void = () => undefined, release: () => void = () => undefined;
  const locked = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const hold = f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SELECT id FROM services WHERE company_id=${f.company} AND id=${must(f.services[0])} FOR UPDATE`); entered(); await held;
  });
  await locked;
  const appending = f.append.execute({ ...f.context(), sessionId: visit.session.id, input: { lines: [f.line()] } });
  await waitFor(waitingService); f.setAt(new Date('2026-11-01T00:00:00Z')); release(); await hold;
  await expect(appending).rejects.toThrow('SESSION_TIME_TOO_OLD'); f.setAt(AT);
});

it('append response-store failure rolls back its delta without changing old rows/header; retry adds once', async () => {
  const first = await f.create.execute({ ...f.context(), input: f.body() });
  const key = ids.newId();
  const wrapped = interceptDatabase(f.db, async (statement) => { if (/UPDATE idempotency_keys/.test(statement)) throw new Error('Synthetic failure'); });
  const append = new AppendServiceSessionLinesUseCase(ordersTransactions(wrapped, ids), ids, f.clock);
  const request = { ...f.context(key), sessionId: first.session.id, input: { lines: [f.line()] } };
  await expect(append.execute(request)).rejects.toThrow('SESSION_PERSISTENCE_FAILED');
  expect(await f.h.owner`SELECT 1 FROM service_lines WHERE session_id=${first.session.id}`).toHaveLength(1);
  expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${first.session.id}`).toHaveLength(1);
  const added = await f.append.execute(request); expect(added.session.lines).toHaveLength(2);
  expect((await f.append.execute(request))).toEqual(added);
});
