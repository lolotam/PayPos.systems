import type { TenantWrappers, Tx } from '@pospay/db';
import { createDatabase } from '@pospay/db';
import { sellPackageInput } from '@pospay/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  bindPackageSaleReaders,
  createPackageSaleTransactions,
} from '../persistence/package-sale-transactions.ts';
import { SellPackageUseCase } from '../use-cases/sell-package/sell-package.usecase.ts';
import { packageSaleVolumeFixture } from './package-sale.fixture.ts';
import { ids } from './session.fixture.ts';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let f: Awaited<ReturnType<typeof packageSaleVolumeFixture>>;
beforeAll(async () => {
  f = await packageSaleVolumeFixture();
});
afterAll(async () => {
  await f?.close();
});

async function explainSlots(tx: Tx, query: SQL, timing: boolean, cache: string) {
  await tx.execute(sql`SET LOCAL plan_cache_mode = ${sql.raw(cache)}`);
  const started = performance.now();
  const rows = await tx.execute(
    sql`EXPLAIN (ANALYZE, BUFFERS, TIMING ${sql.raw(timing ? 'ON' : 'OFF')}, FORMAT JSON) ${query}`,
  );
  const wall = performance.now() - started;
  const plan = (Object.values(rows[0] ?? {})[0] as Record<string, unknown>[])[0];
  const result = {
    writer: 'JSONB',
    timing,
    cache,
    wall,
    planning: plan?.['Planning Time'],
    execution: plan?.['Execution Time'],
    triggers: plan?.['Triggers'],
  };
  writeFileSync(
    join(tmpdir(), `pospay-42b1-slot-profile-${process.pid}-${cache}.json`),
    JSON.stringify(result, null, 2),
  );
  console.info('SA-10 PostgreSQL slot profile:', JSON.stringify(result));
}

it.each([
  { timing: false, cache: 'force_generic_plan' },
  { timing: false, cache: 'force_custom_plan' },
])(
  'profiles the actual slot INSERT with %j and every constraint enabled',
  async ({ timing, cache }) => {
    const dialect = new PgDialect();
    let explained = false;
    const database: TenantWrappers = {
      ...f.db,
      withTenant: (company, work, options) =>
        f.db.withTenant(
          company,
          (tx) =>
            work(
              new Proxy(tx, {
                get: (target, property, receiver) =>
                  property === 'execute'
                    ? async (query: SQL) => {
                        if (
                          !/INSERT INTO package_session_slots/i.test(dialect.sqlToQuery(query).sql)
                        )
                          return target.execute(query);
                        await explainSlots(target, query, timing, cache);
                        explained = true;
                        return [];
                      }
                    : Reflect.get(target, property, receiver),
              }) as Tx,
            ),
          options,
        ),
    };
    const useCase = new SellPackageUseCase(
      createPackageSaleTransactions(database, ids, bindPackageSaleReaders),
      ids,
      f.clock,
    );
    const response = await useCase.execute(
      f.context(),
      sellPackageInput.parse({
        ...f.saleInput(),
        expected_service_revisions: f.volumeServices.map((service_id) => ({
          service_id,
          revision: 1,
        })),
      }),
    );
    const [row] = await f.h
      .owner`SELECT count(*)::int AS count FROM package_session_slots WHERE entitlement_id=${response.entitlement.id}`;
    expect(row?.['count']).toBe(7300);
    expect(explained).toBe(true);
  },
);

it('records nested FK plans on a new restricted connection in this disposable clone only', async () => {
  const [database] = await f.h.owner`SELECT current_database() AS name`;
  const name = String(database?.['name']);
  if (!/^pospay_test_[a-zA-Z0-9_]+$/.test(name)) throw new Error('Expected disposable test clone');
  await f.h.owner`ALTER DATABASE ${f.h.owner(name)} SET session_preload_libraries = 'auto_explain'`;
  await f.h.owner`ALTER DATABASE ${f.h.owner(name)} SET auto_explain.log_min_duration = '0'`;
  await f.h.owner`ALTER DATABASE ${f.h.owner(name)} SET auto_explain.log_nested_statements = 'on'`;
  await f.h.owner`ALTER DATABASE ${f.h.owner(name)} SET auto_explain.log_analyze = 'on'`;
  await f.h.owner`ALTER DATABASE ${f.h.owner(name)} SET auto_explain.log_timing = 'off'`;
  await f.h.owner`ALTER DATABASE ${f.h.owner(name)} SET auto_explain.log_format = 'json'`;
  const traced = createDatabase({ url: f.h.urls.app, ids, maxConnections: 1 });
  try {
    await traced.ping();
    const useCase = new SellPackageUseCase(
      createPackageSaleTransactions(traced, ids, bindPackageSaleReaders),
      ids,
      f.clock,
    );
    const response = await useCase.execute(
      f.context(),
      sellPackageInput.parse({
        ...f.saleInput(),
        expected_service_revisions: f.volumeServices.map((service_id) => ({
          service_id,
          revision: 1,
        })),
      }),
    );
    const [row] = await f.h
      .owner`SELECT count(*)::int AS count FROM package_session_slots WHERE entitlement_id=${response.entitlement.id}`;
    expect(row?.['count']).toBe(7300);
  } finally {
    await traced.close();
    for (const setting of [
      'session_preload_libraries',
      'auto_explain.log_min_duration',
      'auto_explain.log_nested_statements',
      'auto_explain.log_analyze',
      'auto_explain.log_timing',
      'auto_explain.log_format',
    ]) {
      await f.h.owner.unsafe(`ALTER DATABASE "${name}" RESET ${setting}`);
    }
  }
});
