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

// 57-2b plan §5.3 البنود 1–3: موظفة بـ600 زيارة/602 سطراً، وزميلات في نفس النشاط بعشرة أضعاف حجمها (§5.7).
let f: TipFixture;
const dialect = new PgDialect();
const TABLES = ['service_sessions', 'service_lines', 'line_performers'];
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
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Filter?: string;
  'Actual Rows'?: number;
  'Actual Total Time'?: number;
  Plans?: PlanNode[];
}
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
interface Target {
  scope: PerfScope;
  her: string;
  oracle: string[];
}
let target: Target | null = null;
const violations: string[] = [];

beforeAll(async () => {
  f = await tipFixture();
}, 120_000);
afterAll(async () => {
  await f?.close();
});

async function statistics(companyId: string) {
  const rows = await f.h
    .owner`SELECT s.tablename,s.n_distinct::float8 AS n_distinct,s.most_common_vals::text AS company_mcv,
      c.reltuples::float8 AS reltuples,t.last_analyze,t.last_autoanalyze,t.n_mod_since_analyze
    FROM pg_stats s JOIN pg_class c ON c.relname=s.tablename AND c.relnamespace='public'::regnamespace
    JOIN pg_stat_all_tables t ON t.relid=c.oid
    WHERE s.schemaname='public' AND s.attname='company_id'
      AND s.tablename IN ('service_sessions','service_lines','line_performers') ORDER BY s.tablename`;
  const inMcv = rows.map((row) => String(row['company_mcv']).includes(companyId));
  return { rows, absent: rows.length === 3 && inMcv.every((hit) => !hit) };
}

// المرجع المستقل لا يستعمل join ثلاثياً: تحت إحصاءات قديمة يتجاوز ذلك الـjoin مهلة 30 ثانية حتى على اتصال المالك.
// جمل أحادية الجدول، والترتيب والعدّ هنا في الاختبار نفسه.
async function oracle(s: PerfScope, her: string) {
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
  const colleagues = await f.h.owner`SELECT count(*)::int AS lines FROM line_performers
    WHERE company_id=${s.companyId} AND employee_id<>${her}`;
  const sessionOf = new Map(lines.map((row) => [String(row['id']), String(row['session_id'])]));
  const dayOf = new Map(visits.map((row) => [String(row['id']), `${row['day']}|${row['at']}`]));
  const own = lineIds.filter((id) => dayOf.has(must(sessionOf.get(id))));
  expect(visits.length).toBe(600);
  expect(colleagues[0]?.['lines']).toBe(6020);
  expect(own.length).toBe(602);
  const key = (id: string) => `${dayOf.get(must(sessionOf.get(id)))}|${id}`;
  return own.sort((a, b) => (key(a) < key(b) ? 1 : -1));
}

// الشركة الأصلية أولاً، وكل محاولة لاحقة شركة جديدة: التحضير يضمن غياب الشركة من قوائم MCV الثلاث بلا ANALYZE بعد إدخالها.
async function seedTarget(attempt: number): Promise<Target> {
  const home = attempt === 0;
  const scope = home
    ? await (async () => {
        const visit = await recordVisit(f);
        return homePerfScope(f, visit.sessionId, must(visit.lineIds[0]));
      })()
    : await newPerfScope(f, `Synthetic perf target ${attempt}`);
  const her = must(scope.employeeIds[0]);
  const colleagues = scope.employeeIds.slice(1);
  await bulkVisits(f, scope, home ? 599 : 600, [her]);
  await bulkVisits(f, scope, home ? 6020 : 6019, colleagues);
  await secondLines(f, scope, her, 2);
  return { scope, her, oracle: await oracle(scope, her) };
}

const ctx = (s: PerfScope) => ({
  companyId: s.companyId,
  businessId: s.businessId,
  userId: f.ownerId,
});
const request = (t: Target, extra: Partial<OwnLinesRequest>): OwnLinesRequest => ({
  employeeId: t.her,
  month: '2026-10',
  cursor: undefined,
  limit: 20,
  allowed: ALL,
  branches: [{ id: t.scope.branchId, name_ar: null, name_en: 'Synthetic perf branch' }],
  ...extra,
});
const options = () => ({ userId: f.ownerId, readOnly: true });

async function timed(t: Target, req: OwnLinesRequest) {
  const before = process.memoryUsage();
  const started = performance.now();
  const page = await f.db.withTenant(
    t.scope.companyId,
    (tx) => readOwnLinesPage(tx, ctx(t.scope), req),
    options(),
  );
  const elapsed = performance.now() - started;
  const after = process.memoryUsage();
  return {
    page,
    elapsed,
    heap: after.heapUsed - before.heapUsed,
    rss: after.rss - before.rss,
  };
}

// كل جملة تُشرح وتُنفَّذ بنفس معاملاتها داخل نفس اللقطة؛ الخطط تُسجَّل ولا تدخل في زمن القياس.
async function planned(t: Target, req: OwnLinesRequest) {
  const plans: { statement: string; plan: PlanNode }[] = [];
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
        ctx(t.scope),
        req,
      ),
    options(),
  );
  return plans;
}

// البند 3 (أ): لا جملة فيها join أصلاً (فلا جدول يُقرأ لكل صف خارجي)، ولا Seq Scan على الجداول الثلاثة.
function planViolations(label: string, plans: { statement: string; plan: PlanNode }[]) {
  const found: string[] = [];
  if (plans.length < 3) found.push(`${label}: fewer than three statements were planned`);
  for (const { statement, plan } of plans) {
    const all = nodes(plan);
    const name = statement.replace(/\s+/g, ' ').slice(0, 60);
    if (all.some((node) => /Join|Nested Loop/.test(node['Node Type'])))
      found.push(`${label}: join in ${name}`);
    if (
      all.some(
        (node) => node['Node Type'] === 'Seq Scan' && TABLES.includes(node['Relation Name'] ?? ''),
      )
    )
      found.push(`${label}: sequential scan in ${name}`);
  }
  return found;
}

// البند 3 (ب): الجمل التي ظهرت فيها قائمة المعرفات كمرشّح لا كشرط فهرس. تُسجَّل ولا تُمرَّر كنجاح (plan §5.4).
const idListFilters = (plans: { statement: string; plan: PlanNode }[]) =>
  plans
    .filter(({ statement }) => /=\s*ANY/i.test(statement))
    .filter(
      ({ plan }) =>
        !/ANY/.test(
          nodes(plan)
            .map((node) => node['Index Cond'] ?? '')
            .join(' '),
        ),
    )
    .map(({ statement }) => statement.replace(/\s+/g, ' ').slice(0, 60));

const compact = (plans: { statement: string; plan: PlanNode }[]) =>
  plans.map(({ statement, plan }) => ({
    statement: statement.replace(/\s+/g, ' ').slice(0, 90),
    nodes: nodes(plan).map((node) => ({
      type: node['Node Type'],
      table: node['Relation Name'],
      index: node['Index Name'],
      cond: node['Index Cond'],
      filter: node['Filter'],
      rows: node['Actual Rows'],
      ms: node['Actual Total Time'],
    })),
  }));

async function measure(label: string, t: Target) {
  await f.db.withTenant(f.otherCompany, (tx) => tx.execute(sql`SELECT 1`));
  {
    const name = 'ownLines';
    const first = await timed(t, request(t, { limit: 100 }));
    const results = [
      ['first-20', await timed(t, request(t, { limit: 20 })), t.oracle.slice(0, 20)],
      ['first-100', first, t.oracle.slice(0, 100)],
      [
        'cursor-100',
        await timed(t, request(t, { limit: 100, cursor: must(first.page.next_cursor) })),
        t.oracle.slice(100, 200),
      ],
      [
        'deep-cursor-100',
        await timed(t, request(t, { limit: 100, cursor: must(t.oracle[299]) })),
        t.oracle.slice(300, 400),
      ],
    ] as const;
    for (const [page, run, expected] of results) {
      console.info(
        '57-2b measurement',
        JSON.stringify({
          label,
          variant: name,
          page,
          elapsed_ms: run.elapsed,
          heap_delta_bytes: run.heap,
          rss_delta_bytes: run.rss,
        }),
      );
      expect(run.page.items.map((item) => item.line_id)).toEqual(expected);
      if (run.elapsed >= 200) violations.push(`${label} ${name} ${page}: ${run.elapsed} ms`);
    }
    const plans = [
      ...(await planned(t, request(t, { limit: 100 }))),
      ...(await planned(t, request(t, { limit: 100, cursor: must(t.oracle[299]) }))),
    ];
    console.info('57-2b plans', JSON.stringify({ label, variant: name, plans: compact(plans) }));
    console.info(
      '57-2b item-3b',
      JSON.stringify({ label, id_list_as_filter: idListFilters(plans) }),
    );
    violations.push(...planViolations(`${label} ${name}`, plans));
  }
}

it('stale statistics: a new tenant absent from the three MCV lists, no ANALYZE after its insert (AC 1, 3)', async () => {
  for (const name of ['A', 'B']) {
    const background = await newPerfScope(f, `Synthetic perf background ${name}`);
    await bulkVisits(f, background, 1500, background.employeeIds.slice(1));
  }
  await f.h.owner.unsafe('ANALYZE service_sessions,service_lines,line_performers');
  for (let attempt = 0; attempt < 3 && target === null; attempt++) {
    const candidate = await seedTarget(attempt);
    const before = await statistics(candidate.scope.companyId);
    if (!before.absent) continue;
    console.info('57-2b statistics before', JSON.stringify({ attempt, rows: before.rows }));
    await measure('stale statistics', candidate);
    const after = await statistics(candidate.scope.companyId);
    console.info('57-2b statistics after', JSON.stringify({ attempt, rows: after.rows }));
    if (after.absent) target = candidate;
    else violations.length = 0;
  }
  expect(target, 'a tenant absent from every MCV list could not be established').not.toBeNull();
  expect(violations).toEqual([]);
}, 900_000);

it('normal statistics: the same fixture after ANALYZE prepared only this run (AC 2, 3)', async () => {
  const t = must(target);
  await f.h.owner.unsafe('ANALYZE service_sessions,service_lines,line_performers');
  console.info(
    '57-2b statistics normal',
    JSON.stringify((await statistics(t.scope.companyId)).rows),
  );
  await measure('normal statistics', t);
  expect(violations).toEqual([]);
}, 900_000);
