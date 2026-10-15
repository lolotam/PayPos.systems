import { afterAll, beforeAll, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx, TenantWrappers } from '@pospay/db';
import { requestFingerprint } from '../../../shared/idempotency.ts';
import { sessionFixture, ids, must, AT, type SessionFixture } from './session.fixture.ts';
import { ordersTransactions } from '../orders.module.ts';
import { createSessionRecovery } from '../persistence/session-recovery.adapter.ts';
import { RecordServiceSessionUseCase } from '../use-cases/record-service-session/record-service-session.usecase.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });
it('actor/company/route/selection bind the fingerprint; object order matches, arrays and omitted time retain meaning', () => {
  const source = { method: 'POST', route: '/v1/businesses/:businessId/branches/:branchId/service-sessions', query: {},
    params: { businessId: f.business, branchId: f.branch, companyId: f.company, actorUserId: f.userId }, body: { customer_id: f.customer, lines: [f.line(), f.line(f.services[1], '7.125')] } };
  const hash = requestFingerprint(source);
  expect(requestFingerprint({ ...source, body: { lines: source.body.lines, customer_id: f.customer } })).toBe(hash);
  expect(requestFingerprint({ ...source, body: { ...source.body, occurred_at: undefined } })).toBe(hash);
  expect(requestFingerprint({ ...source, body: { ...source.body, occurred_at: AT.toISOString() } })).not.toBe(hash);
  expect(requestFingerprint({ ...source, body: { ...source.body, lines: [...source.body.lines].reverse() } })).not.toBe(hash);
  expect(requestFingerprint({ ...source, params: { ...source.params, actorUserId: f.ownerId } })).not.toBe(hash);
  expect(requestFingerprint({ ...source, params: { ...source.params, companyId: f.otherCompany } })).not.toBe(hash);
  expect(requestFingerprint({ ...source, body: { ...source.body, recorder_membership_id: f.membership } })).not.toBe(hash);
});

it('PARTIAL replay retains original price, limit and warnings after catalog/limit/performer changes', async () => {
  const key = ids.newId(), input = f.body([f.line(), f.line(f.services[1], '7.125', '0.713')]);
  const first = await f.create.execute({ ...f.context(key), input });
  expect(first.outcome).toBe('PARTIAL');
  await f.h.owner`UPDATE services SET price='30.000',revision=revision+1 WHERE company_id=${f.company} AND id=${must(f.services[0])}`;
  await f.h.owner`UPDATE memberships SET limit_bps=0 WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
  expect(await f.create.execute({ ...f.context(key), input })).toEqual(first);
  expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${first.session.id}`).toHaveLength(1);
  await f.h.owner`UPDATE services SET price='25.000' WHERE company_id=${f.company} AND id=${must(f.services[0])}`;
  await f.h.owner`UPDATE memberships SET limit_bps=1000 WHERE company_id=${f.company} AND id=${f.membership}`;
  await f.h.owner`UPDATE employees SET deleted_at=NULL WHERE company_id=${f.company} AND id=${must(f.employees[0])}`;
});

it('a duplicate claim waits and rechecks expiry before releasing replay; the original remains committed', async () => {
  let entered: () => void = () => undefined, release: () => void = () => undefined;
  const claimed = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const dialect = new PgDialect();
  const wrapped: TenantWrappers = { ...f.db, withTenant: (company, work, options) => f.db.withTenant(company, (tx) => work(new Proxy(tx, {
    get: (target, property, receiver) => property === 'execute' ? async (query: SQL) => {
      const statement = dialect.sqlToQuery(query).sql;
      if (/UPDATE idempotency_keys/.test(statement)) { entered(); await held; }
      return target.execute(query);
    } : Reflect.get(target, property, receiver),
  }) as Tx), options) };
  // حد الخصم يقارن بـ clock_timestamp() الحقيقي، فالنهاية تبقى بعده وساعة الاختبار تتجاوزها قبل فك الانتظار.
  await f.h.owner`UPDATE memberships SET ends_at='2099-01-01T00:00:00.000Z' WHERE company_id=${f.company} AND id=${f.membership}`;
  const key = ids.newId(), context = { ...f.context(key), input: f.body() };
  const create = new RecordServiceSessionUseCase(ordersTransactions(wrapped, ids, f.clock), createSessionRecovery(f.db, ids, f.clock), ids, f.clock);
  const original = create.execute(context); await claimed;
  let observed: () => void = () => undefined;
  const replayClaim = new Promise<void>((resolve) => { observed = resolve; });
  const replayDb: TenantWrappers = { ...f.db, withTenant: (company, work, options) => f.db.withTenant(company, (tx) => work(new Proxy(tx, {
    get: (target, property, receiver) => property === 'execute' ? (query: SQL) => {
      if (/INSERT INTO idempotency_keys/.test(dialect.sqlToQuery(query).sql)) observed();
      return target.execute(query);
    } : Reflect.get(target, property, receiver),
  }) as Tx), options) };
  const replay = new RecordServiceSessionUseCase(ordersTransactions(replayDb, ids, f.clock), createSessionRecovery(f.db, ids, f.clock), ids, f.clock).execute(context).then(() => null,(error: unknown) => error);
  await replayClaim; f.setAt(new Date('2099-01-01T00:00:01.000Z')); release();
  const result = await original; expect((await replay) as Error).toMatchObject({ code: 'FORBIDDEN' });
  expect(await f.h.owner`SELECT 1 FROM outbox WHERE aggregate_id=${result.session.id}`).toHaveLength(1);
  await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`; f.setAt(AT);
  expect(await f.db.withTenant(f.company, (tx) => tx.execute(sql`SELECT key FROM idempotency_keys WHERE key=${key}`))).toHaveLength(1);
});
