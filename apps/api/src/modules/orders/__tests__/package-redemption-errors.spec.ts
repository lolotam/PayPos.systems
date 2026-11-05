import type { TenantWrappers, Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ordersTransactions } from '../orders.module.ts';
import { createSessionRecovery } from '../persistence/session-recovery.adapter.ts';
import { RecordServiceSessionUseCase } from '../use-cases/record-service-session/record-service-session.usecase.ts';
import { AppendServiceSessionLinesUseCase } from '../use-cases/append-service-session-lines/append-service-session-lines.usecase.ts';
import { packageLine, seedPackage } from './package-redemption.fixture.ts';
import { AT, ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });

function failingDatabase() {
  const dialect = new PgDialect();
  let original: unknown;
  let statementsAfterError = 0;
  const database: TenantWrappers = { ...f.db,
    withTenant: (company, work, options) => f.db.withTenant(company, (tx) => work(new Proxy(tx, {
      get: (target, property, receiver) => property === 'execute' ? async (query: SQL) => {
        if (original !== undefined) statementsAfterError++;
        const statement = dialect.sqlToQuery(query).sql;
        if (statement.includes('package_components') && statement.includes('FOR UPDATE')) {
          try { await target.execute(sql`SELECT 1 / 0`); }
          catch (error) { original = error; throw error; }
        }
        return target.execute(query);
      } : Reflect.get(target, property, receiver),
    }) as Tx), options),
  };
  return { database, error: () => original, extraStatements: () => statementsAfterError };
}

it.each(['record', 'append'] as const)('#843 %s preserves the original database error from an aborted package transaction', async (route) => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  const visit = route === 'append'
    ? await f.create.execute({ ...f.context(ids.newId()), input: f.body([f.line()]) }) : undefined;
  const failing = failingDatabase();
  const real = ordersTransactions(failing.database, ids, f.clock);
  let boundaryError: unknown;
  const transactions: typeof f.transactions = {
    run: (context, work) => real.run(context, async (tx) => {
      try { return await work(tx); }
      catch (error) { boundaryError = error; throw error; }
    }),
  };
  const recovery = createSessionRecovery(failing.database, ids, f.clock);
  const record = new RecordServiceSessionUseCase(transactions, recovery, ids, f.clock);
  const append = new AppendServiceSessionLinesUseCase(transactions, recovery, ids, f.clock);
  const key = ids.newId();
  const operation = route === 'record'
    ? record.execute({ ...f.context(key), input: f.body([packageLine(f, seeded.entitlement)]) })
    : append.execute({ ...f.context(key), sessionId: must(visit).session.id,
      input: { lines: [packageLine(f, seeded.entitlement)] } });
  let received: unknown;
  try { await operation; } catch (error) { received = error; }
  expect(failing.error()).toBeDefined();
  expect(boundaryError).toBe(failing.error());
  expect(received).toEqual(new Error('SESSION_PERSISTENCE_FAILED'));
  expect(failing.extraStatements()).toBe(0);
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(0);
  expect(await f.h.owner`SELECT 1 FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`).toHaveLength(0);
});

it.each(['expired', 'not-yet-valid'] as const)('#843 append rechecks authority before exposing %s package dates', async (kind) => {
  const seeded = await seedPackage(f, { sessions: 1,
    expiresOn: kind === 'expired' ? '2026-10-13' : '2026-12-30',
    soldAt: kind === 'expired' ? null : new Date('2026-10-15T07:00:00Z'),
  });
  const visit = await f.create.execute({ ...f.context(ids.newId()), input: f.body([f.line()]) });
  f.setAt(new Date('2026-10-15T07:59:30Z'));
  await f.h.owner`UPDATE memberships SET ends_at='2026-10-15T08:00:00Z'
    WHERE company_id=${f.company} AND id=${f.membership}`;
  const transactions: typeof f.transactions = {
    run: (context, work) => f.transactions.run(context, (tx) => work({ ...tx,
      packages: { ...tx.packages, lock: async (customer, pairs) => {
        const snapshots = await tx.packages.lock(customer, pairs);
        f.setAt(new Date('2026-10-15T08:00:30Z'));
        return snapshots;
      } },
    })),
  };
  const append = new AppendServiceSessionLinesUseCase(transactions, createSessionRecovery(f.db, ids, f.clock), ids, f.clock);
  try {
    await expect(append.execute({ ...f.context(ids.newId()), sessionId: visit.session.id,
      input: { lines: [packageLine(f, seeded.entitlement)] } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(0);
  } finally {
    f.setAt(AT);
    await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});
