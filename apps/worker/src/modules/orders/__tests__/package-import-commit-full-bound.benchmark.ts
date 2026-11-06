import { afterAll, beforeAll, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Tx, TenantWrappers } from '@pospay/db';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { CommitPackageImport } from '../use-cases/commit-package-import/commit-package-import.ts';
import { packageImportCommitTransactions } from '../persistence/package-import-commit.transactions.ts';
import {
  packagePreviewFixture,
  packageWorkbook,
  type PackagePreviewFixture,
} from './package-preview.fixture.ts';
let f: PackagePreviewFixture;
let membership: string;
const timeoutMs = 30 * 60 * 1000; // Benchmark ceiling, not a measured production budget.
beforeAll(async () => {
  f = await packagePreviewFixture();
  membership = f.ids.newId();
  const [role] = await f.owner`SELECT id FROM roles WHERE company_id IS NULL AND code='owner'`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${f.company},${membership},${USER},${role?.['id']},'global','COMPANY',${f.company})`;
});
afterAll(async () => {
  if (f) await f.close();
});
function worker() {
  return new CommitPackageImport(
    packageImportCommitTransactions(measuredDatabase(), f.ids, { timeoutMs }),
    f.clock,
  );
}
async function accepted(prefix: string, count = 1, groups = 2) {
  const { id } = await f.requested(await packageWorkbook(count, groups, prefix));
  await f.worker.execute(f.company, id);
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`UPDATE import_previews SET status='commit_requested',requested_at='2026-11-05T12:00:00Z',
      commit_membership_id=${membership} WHERE id=${id}`);
  });
  return id;
}
// Opt-in config selects this benchmark; the normal src/**/*.spec.ts glob excludes it.
it(
  'BENCHMARK full 3,650,000-slot completed COMMIT and peak memory',
  async () => {
    const id = await accepted('full-bound', 500, 20);
    let peakRss = process.memoryUsage().rss;
    let peakHeap = process.memoryUsage().heapUsed;
    const sampler = setInterval(() => {
      const m = process.memoryUsage();
      peakRss = Math.max(peakRss, m.rss);
      peakHeap = Math.max(peakHeap, m.heapUsed);
    }, 10);
    const started = performance.now();
    try {
      await worker().execute(f.company, id);
      const elapsedMs = performance.now() - started;
      const [count] =
        await f.owner`SELECT count(*)::int AS slots, count(DISTINCT s.entitlement_id)::int AS entitlements,
        count(DISTINCT s.component_id)::int AS components, sum(s.unit_value)::text AS money,
        count(*) FILTER (WHERE s.state='IMPORTED_USED')::int AS used FROM package_session_slots s
      JOIN package_entitlements e ON e.company_id=s.company_id AND e.id=s.entitlement_id WHERE e.import_batch_id=${id}`;
      expect(count?.['slots']).toBe(3650000);
      expect(count).toMatchObject({
        entitlements: 500,
        components: 10000,
        money: '5000.500',
        used: 10000,
      });
      expect(elapsedMs).toBeLessThanOrEqual(timeoutMs);
      expect(
        (await f.owner`SELECT status,created_count FROM import_previews WHERE id=${id}`)[0],
      ).toMatchObject({ status: 'committed', created_count: 500 });
      record({
        elapsedMs,
        peakRss,
        peakHeap,
        timeoutMs,
        completedCommit: true,
        slots: 3650000,
      });
    } finally {
      clearInterval(sampler);
    }
  },
  timeoutMs + 120000,
);

function measuredDatabase(): Pick<TenantWrappers, 'withTenant'> {
  return {
    withTenant: (company, work, options) =>
      f.database.withTenant(
        company,
        (tx) => {
          const dialect = new PgDialect();
          const batches = new Map<string, number>();
          const started = performance.now();
          return work(
            new Proxy(tx, {
              get(target, key) {
                if (key === 'execute')
                  return async (query: Parameters<Tx['execute']>[0]) => {
                    const text =
                      typeof query === 'string' ? query : dialect.sqlToQuery(query.getSQL()).sql;
                    const table =
                      /^INSERT INTO (package_session_slots|package_components|package_entitlements)/.exec(
                        text.trimStart(),
                      )?.[1];
                    const before = performance.now();
                    const next = table ? (batches.get(table) ?? 0) + 1 : 0;
                    const explainComponent =
                      table === 'package_components' &&
                      [1, 250, 500].includes(next) &&
                      typeof query !== 'string';
                    const result = explainComponent
                      ? await target.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`)
                      : await target.execute(query);
                    if (explainComponent) recordComponentPlan(result, next);
                    if (table) {
                      const batch = (batches.get(table) ?? 0) + 1;
                      batches.set(table, batch);
                      if (batch === 1 || batch % 50 === 0)
                        record({
                          stage: table,
                          batch,
                          statementMs: performance.now() - before,
                          elapsedMs: performance.now() - started,
                        });
                    }
                    return explainComponent ? [] : result;
                  };
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            }),
          );
        },
        options,
      ),
  };
}

function record(value: unknown) {
  const line = JSON.stringify(value);
  const destination = process.env['PACKAGE_BENCHMARK_OUTPUT'];
  if (destination) appendFileSync(destination, line + '\n');
  console.info(line);
}

function recordComponentPlan(result: ReadonlyArray<Record<string, unknown>>, batch: number) {
  const plan = (result[0]?.['QUERY PLAN'] as Record<string, unknown>[])[0];
  record({
    stage: 'componentTriggers',
    batch,
    executionMs: plan?.['Execution Time'],
    triggers: plan?.['Triggers'],
  });
}
