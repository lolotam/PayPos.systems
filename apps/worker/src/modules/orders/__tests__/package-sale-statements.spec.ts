import { afterAll, beforeAll, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { TenantWrappers, Tx } from '@pospay/db';
import { packageSaleTransactions } from '../persistence/package-sale.transactions.ts';
import { ExecutePackageSale } from '../use-cases/execute-package-sale/execute-package-sale.ts';
import { packageSaleFixture, type PackageSaleFixture } from './package-sale.fixture.ts';

let f: PackageSaleFixture;

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

/**
 * بيسجّل نصوص الـ statements اللي اتنفذت جوه معاملة البيع، عشان نعدّ Insert واحدة لكل جدول مالي.
 */
function recordingDatabase(
  fixture: PackageSaleFixture,
  statements: string[],
): Pick<TenantWrappers, 'withTenant'> {
  const dialect = new PgDialect();
  return {
    withTenant: (companyId, work, options) =>
      fixture.database.withTenant(
        companyId,
        (tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                if (key !== 'execute') {
                  const value = Reflect.get(target, key, target);
                  return typeof value === 'function' ? value.bind(target) : value;
                }
                return async (query: Parameters<Tx['execute']>[0]) => {
                  const text =
                    typeof query === 'string'
                      ? query
                      : dialect.sqlToQuery(query.getSQL()).sql;
                  statements.push(text.trimStart());
                  return target.execute(query);
                };
              },
            }),
          ),
        options,
      ),
  };
}

it('writes the 20 x 365 sale with exactly one insert per financial table', async () => {
  const statements: string[] = [];
  const database = recordingDatabase(f, statements);
  const type = await f.seedType({
    price: '20.000',
    validityDays: 365,
    components: Array.from({ length: 20 }, () => ({ sessions: 365, price: '1.000' })),
  });
  const requestId = await f.request({ type, price_paid: '20.000' });
  const worker = new ExecutePackageSale(
    packageSaleTransactions(database, f.ids, { timeoutMs: 30_000 }),
    f.ids,
    f.clock,
  );
  await worker.execute(f.company, requestId);
  const inserts = (table: string): number =>
    statements.filter((text) => text.startsWith(`INSERT INTO ${table}`)).length;
  expect(inserts('package_entitlements')).toBe(1);
  expect(inserts('package_components')).toBe(1);
  expect(inserts('package_session_slots')).toBe(1);
  const state = await f.state(requestId);
  expect(state.status).toBe('completed');
  const [totals] = await f.owner`SELECT count(*)::int AS slots, sum(unit_value)::text AS money
    FROM package_session_slots WHERE entitlement_id=${state.entitlement_id}`;
  expect(totals?.['slots']).toBe(7300);
  expect(totals?.['money']).toBe('20.000');
}, 120000);
