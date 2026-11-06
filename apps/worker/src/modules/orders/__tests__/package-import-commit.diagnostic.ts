import { appendFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { TenantWrappers } from '@pospay/db';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { CommitPackageImport } from '../use-cases/commit-package-import/commit-package-import.ts';
import { packageImportCommitTransactions } from '../persistence/package-import-commit.transactions.ts';
import type {
  PackageCommitTransactions,
  PackageCommitScope,
} from '../ports/package-import-commit.port.ts';
import { packagePreviewFixture, packageWorkbook } from './package-preview.fixture.ts';

const timeoutMs = 30 * 60 * 1000;
function record(value: unknown) {
  const destination = process.env['PACKAGE_DIAGNOSTIC_OUTPUT'];
  if (!destination) throw new Error('DIAGNOSTIC_OUTPUT_REQUIRED');
  appendFileSync(destination, JSON.stringify(value) + '\n');
}
function safeError(error: unknown) {
  const result: Record<string, string>[] = [];
  let current = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const e = current as Error & { code?: unknown; constraint_name?: unknown; cause?: unknown };
    const entry: Record<string, string> = {};
    for (const [key, value] of Object.entries({
      type: e.name,
      code: e.code,
      constraint: e.constraint_name,
    }))
      if (typeof value === 'string' && /^[A-Za-z0-9_]{1,100}$/.test(value)) entry[key] = value;
    result.push(entry);
    current = e.cause;
  }
  return result;
}
function planSummary(node: Record<string, unknown>): unknown {
  const allowed =
    /^(Node Type|Index Name|Actual Rows|Actual Loops|Actual Startup Time|Actual Total Time|Shared Hit Blocks|Shared Read Blocks|Shared Dirtied Blocks|Shared Written Blocks|Temp Read Blocks|Temp Written Blocks)$/;
  return {
    ...Object.fromEntries(Object.entries(node).filter(([key]) => allowed.test(key))),
    Plans: ((node['Plans'] ?? []) as Record<string, unknown>[]).map(planSummary),
  };
}

it(
  'DIAGNOSTIC completed COMMIT sequential fresh clones 1/10/50/100',
  async () => {
    for (const rows of [1, 10, 50, 100]) await runCase(rows);
  },
  timeoutMs,
);

async function runCase(rows: number) {
  const started = performance.now();
  const metrics = createMetrics(rows);
  let f: Awaited<ReturnType<typeof packagePreviewFixture>> | undefined;
  let sampling: ReturnType<typeof sampleCase> | undefined;
  let sampler: ReturnType<typeof setInterval> | undefined;
  let stage = 'fixture';
  let failed = false;
  try {
    f = await packagePreviewFixture();
    const fixture = f;
    const id = await prepareCase(f, rows);
    const database = diagnosticDatabase(fixture, rows);
    const base = packageImportCommitTransactions(database, f.ids, { timeoutMs });
    const port = measuredPort(base, metrics, (value) => {
      stage = value;
    });
    sampling = sampleCase(fixture, rows, started, metrics, () => stage);
    sampler = sampling.timer;
    await new CommitPackageImport(port, f.clock).execute(f.company, id);
    clearInterval(sampler);
    await sampling.wait();
    stage = 'verification';
    await verifyCase(f, id, rows, (value) => {
      stage = value;
    });
  } catch (error) {
    failed = true;
    record({ rows, event: 'failure', stage, errors: safeError(error) });
  } finally {
    clearInterval(sampler);
    await sampling?.wait();
    record({ event: 'caseEnd', stage, failed, elapsedMs: performance.now() - started, ...metrics });
    if (f) await f.close();
  }
  if (failed) throw new Error('DIAGNOSTIC_CASE_FAILED_SEE_SAFE_ARTIFACT');
}

async function verifyCase(
  f: Awaited<ReturnType<typeof packagePreviewFixture>>,
  id: string,
  rows: number,
  setStage: (value: string) => void,
) {
  const fixture = f;
  const [counts] = await f.owner`SELECT count(*)::int AS slots,
        count(DISTINCT s.entitlement_id)::int AS entitlements,count(DISTINCT s.component_id)::int AS components,
        sum(s.unit_value)::text AS money FROM package_session_slots s
        JOIN package_entitlements e ON e.company_id=s.company_id AND e.id=s.entitlement_id WHERE e.import_batch_id=${id}`;
  expect(counts).toMatchObject({ slots: rows * 7300, entitlements: rows, components: rows * 20 });
  expect(counts?.['money']).toBe(
    ((BigInt(rows) * 10001n) / 1000n).toString() +
      '.' +
      ((BigInt(rows) * 10001n) % 1000n).toString().padStart(3, '0'),
  );
  expect(
    (await f.owner`SELECT status,created_count FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'committed', created_count: rows });
  record({ rows, event: 'verified', counts });
  if (rows === 50) {
    setStage('explain');
    await f.db.withTenant(f.company, async (tx) => {
      const [identity] = await tx.execute(sql`SELECT current_user AS role`);
      expect(identity?.['role']).toBe('pospay_app');
      const [entitlement] = await tx.execute(
        sql`SELECT id FROM package_entitlements WHERE import_batch_id=${id} ORDER BY import_row LIMIT 1`,
      );
      const result = await tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
            SELECT c.id FROM package_components c LEFT JOIN package_session_slots s
            ON s.company_id=c.company_id AND s.business_id=c.business_id AND s.entitlement_id=c.entitlement_id AND s.component_id=c.id
            WHERE c.company_id=${fixture.company} AND c.business_id=${fixture.business} AND c.entitlement_id=${entitlement?.['id'] as string}
            GROUP BY c.id,c.sessions_total,c.component_value
            HAVING count(s.id)<>c.sessions_total OR count(DISTINCT s.ordinal)<>c.sessions_total
            OR min(s.ordinal) IS DISTINCT FROM 1 OR max(s.ordinal) IS DISTINCT FROM c.sessions_total
            OR coalesce(sum(s.unit_value),0) IS DISTINCT FROM c.component_value`);
      const plan = (result[0]?.['QUERY PLAN'] as Record<string, unknown>[])[0];
      record({
        rows,
        event: 'explain',
        role: 'pospay_app',
        plan: planSummary(plan?.['Plan'] as Record<string, unknown>),
        planningMs: plan?.['Planning Time'],
        executionMs: plan?.['Execution Time'],
      });
    });
  }
}

async function prepareCase(f: Awaited<ReturnType<typeof packagePreviewFixture>>, rows: number) {
  const membership = f.ids.newId();
  const [role] = await f.owner`SELECT id FROM roles WHERE company_id IS NULL AND code='owner'`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
        VALUES(${f.company},${membership},${USER},${role?.['id']},'global','COMPANY',${f.company})`;
  const { id } = await f.requested(await packageWorkbook(rows, 20, 'diagnostic'));
  await f.worker.execute(f.company, id);
  await f.db.withTenant(f.company, (tx) =>
    tx
      .execute(
        sql`UPDATE import_previews SET status='commit_requested',
        requested_at='2026-11-05T12:00:00Z',commit_membership_id=${membership} WHERE id=${id}`,
      )
      .then(() => undefined),
  );
  return id;
}

function sampleCase(
  fixture: Awaited<ReturnType<typeof packagePreviewFixture>>,
  rows: number,
  started: number,
  metrics: { peakRss: number; peakHeap: number },
  stage: () => string,
) {
  let busy: Promise<void> | undefined;
  const timer = setInterval(() => {
    const memory = process.memoryUsage();
    metrics.peakRss = Math.max(metrics.peakRss, memory.rss);
    metrics.peakHeap = Math.max(metrics.peakHeap, memory.heapUsed);
    if (busy) return;
    busy = (async () => {
      try {
        const samples = await fixture.owner`SELECT state,wait_event_type,wait_event,
              CASE WHEN upper(ltrim(query)) LIKE 'INSERT%' THEN 'INSERT'
                WHEN upper(ltrim(query)) LIKE 'SELECT%' THEN 'SELECT'
                WHEN upper(ltrim(query)) LIKE 'UPDATE%' THEN 'UPDATE'
                WHEN upper(ltrim(query)) LIKE 'COMMIT%' THEN 'COMMIT'
                WHEN upper(ltrim(query)) LIKE 'ROLLBACK%' THEN 'ROLLBACK' ELSE 'OTHER' END AS category,
              count(*)::int AS count FROM pg_stat_activity
              WHERE datname=current_database() AND usename='pospay_app' AND pid<>pg_backend_pid()
              GROUP BY 1,2,3,4`;
        record({
          rows,
          event: 'sample',
          elapsedMs: performance.now() - started,
          stage: stage(),
          samples,
        });
      } catch (error) {
        record({ rows, event: 'samplerError', errors: safeError(error) });
      } finally {
        busy = undefined;
      }
    })();
  }, 1000);
  return { timer, wait: () => busy };
}

function diagnosticDatabase(
  fixture: Awaited<ReturnType<typeof packagePreviewFixture>>,
  rows: number,
) {
  const database: Pick<TenantWrappers, 'withTenant'> = {
    withTenant: async (company, work, options) => {
      try {
        return await fixture.database.withTenant(company, work, options);
      } catch (error) {
        record({ rows, event: 'beforeRetryRawDatabaseError', errors: safeError(error) });
        throw error;
      }
    },
  };
  return database;
}

function createMetrics(rows: number) {
  return {
    rows,
    timeoutMs,
    lockMs: 0,
    insertMs: 0,
    slotsMs: 0,
    completeMs: 0,
    inserted: 0,
    callbackEndMs: null as number | null,
    runReturnMs: null as number | null,
    tailMs: null as number | null,
    completedCommit: false,
    peakRss: 0,
    peakHeap: 0,
  };
}
type Metrics = ReturnType<typeof createMetrics>;
type StageMetric = 'lockMs' | 'insertMs' | 'slotsMs' | 'completeMs';

async function timeStage<T>(
  context: { metrics: Metrics; setStage: (value: string) => void },
  name: StageMetric,
  work: () => Promise<T>,
) {
  context.setStage(name);
  const begin = performance.now();
  try {
    return await work();
  } finally {
    context.metrics[name] += performance.now() - begin;
  }
}

function timedScope(
  scope: PackageCommitScope,
  metrics: Metrics,
  setStage: (value: string) => void,
): PackageCommitScope {
  const context = { metrics, setStage };
  return {
    ...scope,
    lockServices: (values) => timeStage(context, 'lockMs', () => scope.lockServices(values)),
    insert: (row, at) =>
      timeStage(context, 'insertMs', async () => {
        const inserted = await scope.insert(row, at);
        if (inserted) metrics.inserted++;
        return inserted;
      }),
    writeSlots: () => timeStage(context, 'slotsMs', () => scope.writeSlots()),
    complete: (count, at) => timeStage(context, 'completeMs', () => scope.complete(count, at)),
  };
}

function measuredPort(
  base: PackageCommitTransactions,
  metrics: Metrics,
  setStage: (value: string) => void,
): PackageCommitTransactions {
  return {
    fail: base.fail,
    run: async (company, preview, work) => {
      const begin = performance.now();
      try {
        await base.run(company, preview, async (scope) => {
          try {
            await work(timedScope(scope, metrics, setStage));
          } finally {
            metrics.callbackEndMs = performance.now() - begin;
            setStage('commitTail');
          }
        });
        metrics.completedCommit = true;
      } catch (error) {
        record({ rows: metrics.rows, event: 'beforeRetryPortError', errors: safeError(error) });
        throw error;
      } finally {
        metrics.runReturnMs = performance.now() - begin;
        if (metrics.callbackEndMs !== null)
          metrics.tailMs = metrics.runReturnMs - metrics.callbackEndMs;
      }
    },
  };
}
