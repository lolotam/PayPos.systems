import type { TenantWrappers, Tx } from '@pospay/db';
import { sellPackageInput } from '@pospay/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bindPackageSaleReaders, createPackageSaleTransactions } from '../persistence/package-sale-transactions.ts';
import { SellPackageUseCase } from '../use-cases/sell-package/sell-package.usecase.ts';
import { packageSaleVolumeFixture } from './package-sale.fixture.ts';
import { ids } from './session.fixture.ts';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let f: Awaited<ReturnType<typeof packageSaleVolumeFixture>>;
beforeAll(async () => { f = await packageSaleVolumeFixture(); });
afterAll(async () => { await f?.close(); });

it('profiles the actual slot INSERT with PostgreSQL trigger timings, without bypassing its checks', async () => {
  const dialect = new PgDialect();
  let explained = false;
  const database: TenantWrappers = {
    ...f.db,
    withTenant: (company, work, options) => f.db.withTenant(company, (tx) => work(new Proxy(tx, {
      get: (target, property, receiver) => property === 'execute'
        ? async (query: SQL) => {
          if (!/INSERT INTO package_session_slots/i.test(dialect.sqlToQuery(query).sql)) return target.execute(query);
          const rows = await target.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
          const plan = (Object.values(rows[0] ?? {})[0] as Record<string, unknown>[])[0];
          explained = true;
          writeFileSync(join(tmpdir(), `pospay-42b1-slot-profile-${process.pid}.json`), JSON.stringify({
            planning: plan?.['Planning Time'], execution: plan?.['Execution Time'], triggers: plan?.['Triggers'],
          }, null, 2));
          console.info('SA-10 PostgreSQL slot profile:', JSON.stringify({
            planning: plan?.['Planning Time'], execution: plan?.['Execution Time'], triggers: plan?.['Triggers'],
          }));
          return [];
        }
        : Reflect.get(target, property, receiver),
    }) as Tx), options),
  };
  const useCase = new SellPackageUseCase(createPackageSaleTransactions(database, ids, bindPackageSaleReaders), ids, f.clock);
  const response = await useCase.execute(f.context(), sellPackageInput.parse({
    ...f.saleInput(), expected_service_revisions: f.volumeServices.map((service_id) => ({ service_id, revision: 1 })),
  }));
  const [row] = await f.h.owner`SELECT count(*)::int AS count FROM package_session_slots WHERE entitlement_id=${response.entitlement.id}`;
  expect(row?.['count']).toBe(7300);
  expect(explained).toBe(true);
});
