import type { TenantWrappers, Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { performance } from 'node:perf_hooks';

export function profileSaleDatabase(database: TenantWrappers, statements: string[]) {
  const phases: { label: string; ms: number }[] = [];
  const dialect = new PgDialect();
  const recording = (tx: Tx): Tx =>
    new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              const compiled = dialect.sqlToQuery(query);
              statements.push(compiled.sql);
              const label = compiled.sql.replace(/\s+/g, ' ').trim().slice(0, 110);
              const started = performance.now();
              try {
                return await target.execute(query);
              } finally {
                phases.push({ label, ms: performance.now() - started });
              }
            }
          : Reflect.get(target, property, receiver),
    });
  const wrappers: TenantWrappers = {
    ...database,
    withTenant: async (company, work, options) => {
      const started = performance.now();
      let entered = started;
      let finished = started;
      const response = await database.withTenant(
        company,
        async (tx) => {
          entered = performance.now();
          const response = await work(recording(tx));
          finished = performance.now();
          return response;
        },
        options,
      );
      phases.push({ label: 'transaction_entry', ms: entered - started });
      phases.push({ label: 'commit_and_return', ms: performance.now() - finished });
      return response;
    },
  };
  return { database: wrappers, phases };
}
