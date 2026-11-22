import { afterAll, beforeAll, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { StaffColumnCode } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { readOwnLinesPage, type OwnLinesRequest } from '../queries/own-service-lines.query.ts';
import {
  must,
  recordVisit,
  tipFixture,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';
import {
  bulkVisits,
  homePerfScope,
  newPerfScope,
  secondLines,
  type PerfScope,
} from './own-service-lines.seed.ts';
import {
  STATEMENTS_PER_PAGE,
  compactPlans,
  idListFilters,
  planViolations,
  type PlanNode,
  type Planned,
} from './own-service-lines.plans.ts';

// plan §5.3 البنود 1–3: موظفة بـ600 زيارة/602 سطراً، وزميلات في نفس النشاط بحجم `colleagues` سطراً.
export interface PerfConfig {
  colleagues: number;
  warm: number;
  background: number;
}
interface Target {
  scope: PerfScope;
  her: string;
  oracle: string[];
}
const ALL: ReadonlySet<StaffColumnCode> = new Set([
  'date',
  'time',
  'service',
  'customer_name',
  'list_price',
  'discount',
  'net',
  'share',
]);
const dialect = new PgDialect();
const options = (f: TipFixture) => ({ userId: f.ownerId, readOnly: true });

async function statistics(f: TipFixture, companyId: string) {
  const rows = await f.h
    .owner`SELECT s.tablename,s.n_distinct::float8 AS n_distinct,s.most_common_vals::text AS company_mcv,
      c.reltuples::float8 AS reltuples,t.last_analyze,t.last_autoanalyze,t.n_mod_since_analyze
    FROM pg_stats s JOIN pg_class c ON c.relname=s.tablename AND c.relnamespace='public'::regnamespace
    JOIN pg_stat_all_tables t ON t.relid=c.oid
    WHERE s.schemaname='public' AND s.attname='company_id'
      AND s.tablename IN ('service_sessions','service_lines','line_performers') ORDER BY s.tablename`;
  const absent =
    rows.length === 3 && rows.every((row) => !String(row['company_mcv']).includes(companyId));
  return { rows, absent };
}

// المرجع المستقل لا يستعمل join ثلاثياً: تحت إحصاءات قديمة يتجاوز ذلك الـjoin مهلة 30 ثانية حتى على اتصال المالك.
async function oracle(f: TipFixture, s: PerfScope, her: string, config: PerfConfig) {
  const performed = await f.h.owner`SELECT line_id FROM line_performers
    WHERE company_id=${s.companyId} AND business_id=${s.businessId} AND employee_id=${her}`;
  const lineIds = performed.map((row) => String(row['line_id']));
  const lines = await f.h.owner`SELECT id,session_id FROM service_lines
    WHERE company_id=${s.companyId} AND business_id=${s.businessId} AND id=ANY(${lineIds}::uuid[])`;
  const sessionIds = [...new Set(lines.map((row) => String(row['session_id'])))];
  const visits = await f.h.owner`SELECT id,business_date::text AS day,
      to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US') AS at FROM service_sessions
    WHERE company_id=${s.companyId} AND business_id=${s.businessId} AND id=ANY(${sessionIds}::uuid[])
      AND business_date>='2026-10-01' AND business_date<'2026-11-01'`;
  const counts = await f.h.owner`SELECT
    (SELECT count(*)::int FROM line_performers WHERE company_id=${s.companyId} AND employee_id<>${her}) AS colleagues,
    (SELECT count(*)::int FROM service_lines WHERE company_id=${s.companyId}) AS lines`;
  const sessionOf = new Map(lines.map((row) => [String(row['id']), String(row['session_id'])]));
  const dayOf = new Map(visits.map((row) => [String(row['id']), `${row['day']}|${row['at']}`]));
  const own = lineIds.filter((id) => dayOf.has(must(sessionOf.get(id))));
  expect(visits.length).toBe(600);
  expect(counts[0]?.['colleagues']).toBe(config.colleagues);
  expect(counts[0]?.['lines']).toBe(config.colleagues + 602);
  expect(own.length).toBe(602);
  const key = (id: string) => `${dayOf.get(must(sessionOf.get(id)))}|${id}`;
  console.info(
    '57-2b fixture',
    JSON.stringify({ own_lines: own.length, own_visits: visits.length, ...counts[0] }),
  );
  return own.sort((a, b) => (key(a) < key(b) ? 1 : -1));
}

// الشركة الأصلية أولاً، وكل محاولة لاحقة شركة جديدة: التحضير يضمن غياب الشركة من قوائم MCV الثلاث بلا ANALYZE بعد إدخالها.
async function seedTarget(f: TipFixture, attempt: number, config: PerfConfig): Promise<Target> {
  const home = attempt === 0;
  const scope = home
    ? await (async () => {
        const visit = await recordVisit(f);
        return homePerfScope(f, visit.sessionId, must(visit.lineIds[0]));
      })()
    : await newPerfScope(f, `Synthetic perf target ${attempt}`);
  const her = must(scope.employeeIds[0]);
  await bulkVisits(f, scope, home ? 599 : 600, [her]);
  const others = scope.employeeIds.slice(1);
  await bulkVisits(f, scope, home ? config.colleagues : config.colleagues - 1, others);
  await secondLines(f, scope, her, 2);
  return { scope, her, oracle: await oracle(f, scope, her, config) };
}

const request = (t: Target, extra: Partial<OwnLinesRequest>): OwnLinesRequest => ({
  employeeId: t.her,
  month: '2026-10',
  cursor: undefined,
  limit: 20,
  allowed: ALL,
  branches: [{ id: t.scope.branchId, name_ar: null, name_en: 'Synthetic perf branch' }],
  ...extra,
});
const ctx = (f: TipFixture, s: PerfScope) => ({
  companyId: s.companyId,
  businessId: s.businessId,
  userId: f.ownerId,
});

// يعدّ الجمل المنفّذة في الطلب الواحد من نفس اللقطة؛ العدد ثابت لا يتبع حجم الصفحة ولا حجم المستأجر.
async function timed(f: TipFixture, t: Target, req: OwnLinesRequest) {
  let statements = 0;
  const before = process.memoryUsage();
  const started = performance.now();
  const page = await f.db.withTenant(
    t.scope.companyId,
    (tx) =>
      readOwnLinesPage(
        new Proxy(tx, {
          get: (target, property, receiver) =>
            property === 'execute'
              ? (query: SQL) => {
                  statements++;
                  return target.execute(query);
                }
              : Reflect.get(target, property, receiver),
        }) as Tx,
        ctx(f, t.scope),
        req,
      ),
    options(f),
  );
  const elapsed = performance.now() - started;
  const after = process.memoryUsage();
  return {
    page,
    elapsed,
    statements,
    heap: after.heapUsed - before.heapUsed,
    rss: after.rss - before.rss,
  };
}

// كل جملة تُشرح وتُنفَّذ بنفس معاملاتها داخل نفس اللقطة؛ الخطط تُسجَّل ولا تدخل في زمن القياس.
async function planned(f: TipFixture, t: Target, req: OwnLinesRequest) {
  const plans: Planned = [];
  await f.db.withTenant(
    t.scope.companyId,
    (tx) =>
      readOwnLinesPage(
        new Proxy(tx, {
          get: (target, property, receiver) =>
            property === 'execute'
              ? async (query: SQL) => {
                  const explained = await target.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
                    sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`,
                  );
                  plans.push({
                    statement: dialect.sqlToQuery(query).sql,
                    plan: must(must(explained[0])['QUERY PLAN'][0]).Plan,
                  });
                  return target.execute(query);
                }
              : Reflect.get(target, property, receiver),
        }) as Tx,
        ctx(f, t.scope),
        req,
      ),
    options(f),
  );
  return plans;
}

async function measure(
  f: TipFixture,
  label: string,
  t: Target,
  config: PerfConfig,
  violations: string[],
) {
  await f.db.withTenant(f.otherCompany, (tx) => tx.execute(sql`SELECT 1`));
  const first = await timed(f, t, request(t, { limit: 100 }));
  const pages: [string, OwnLinesRequest, string[]][] = [
    ['first-20', request(t, { limit: 20 }), t.oracle.slice(0, 20)],
    ['first-100', request(t, { limit: 100 }), t.oracle.slice(0, 100)],
    [
      'cursor-100',
      request(t, { limit: 100, cursor: must(first.page.next_cursor) }),
      t.oracle.slice(100, 200),
    ],
    [
      'deep-cursor-100',
      request(t, { limit: 100, cursor: must(t.oracle[299]) }),
      t.oracle.slice(300, 400),
    ],
  ];
  for (const [page, req, expected] of pages)
    for (let sample = 0; sample <= config.warm; sample++) {
      const run = await timed(f, t, req);
      const name = sample === 0 ? 'first-run' : `warm-${sample}`;
      console.info(
        '57-2b measurement',
        JSON.stringify({
          label,
          page,
          sample: name,
          elapsed_ms: run.elapsed,
          statements: run.statements,
          heap_delta_bytes: run.heap,
          rss_delta_bytes: run.rss,
        }),
      );
      expect(run.page.items.map((item) => item.line_id)).toEqual(expected);
      if (run.statements !== STATEMENTS_PER_PAGE)
        violations.push(`${label} ${page}: ${run.statements} statements`);
      if (run.elapsed >= 200) violations.push(`${label} ${page} ${name}: ${run.elapsed} ms`);
    }
  const deep = request(t, { limit: 100, cursor: must(t.oracle[299]) });
  const firstPlans = await planned(f, t, request(t, { limit: 100 }));
  const deepPlans = await planned(f, t, deep);
  console.info(
    '57-2b plans',
    JSON.stringify({ label, plans: compactPlans([...firstPlans, ...deepPlans]) }),
  );
  console.info(
    '57-2b item-3b',
    JSON.stringify({ label, id_list_as_filter: idListFilters([...firstPlans, ...deepPlans]) }),
  );
  violations.push(...planViolations(label, firstPlans), ...planViolations(label, deepPlans));
}

export function perfSuite(config: PerfConfig) {
  let f: TipFixture;
  let target: Target | null = null;
  const violations: string[] = [];
  beforeAll(async () => {
    f = await tipFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });

  it('stale statistics: a new tenant absent from the three MCV lists, no ANALYZE after its insert (AC 1, 3)', async () => {
    for (let n = 0; n < 2; n++) {
      const background = await newPerfScope(f, `Synthetic perf background ${n}`);
      await bulkVisits(f, background, config.background, background.employeeIds.slice(1));
    }
    await f.h.owner.unsafe('ANALYZE service_sessions,service_lines,line_performers');
    for (let attempt = 0; attempt < 3 && target === null; attempt++) {
      const candidate = await seedTarget(f, attempt, config);
      const before = await statistics(f, candidate.scope.companyId);
      if (!before.absent) continue;
      console.info('57-2b statistics before', JSON.stringify({ attempt, rows: before.rows }));
      await measure(f, 'stale statistics', candidate, config, violations);
      const after = await statistics(f, candidate.scope.companyId);
      console.info('57-2b statistics after', JSON.stringify({ attempt, rows: after.rows }));
      if (after.absent) target = candidate;
      else violations.length = 0;
    }
    expect(target, 'a tenant absent from every MCV list could not be established').not.toBeNull();
    expect(violations).toEqual([]);
  }, 1_800_000);

  it('normal statistics: the same fixture after ANALYZE prepared only this run (AC 2, 3)', async () => {
    const t = must(target);
    await f.h.owner.unsafe('ANALYZE service_sessions,service_lines,line_performers');
    const normal = await statistics(f, t.scope.companyId);
    console.info('57-2b statistics normal', JSON.stringify(normal.rows));
    await measure(f, 'normal statistics', t, config, violations);
    expect(violations).toEqual([]);
  }, 1_800_000);
}
