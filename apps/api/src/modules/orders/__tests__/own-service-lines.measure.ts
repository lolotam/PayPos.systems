import { expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { StaffColumnCode } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { OwnServiceLines as OwnLinesPage } from '@pospay/contracts';
import { readOwnLinesPage, type OwnLinesRequest } from '../queries/own-service-lines.query.ts';
import { must, type TipFixture } from '../../../../test/session-tips.fixture.ts';
import type { PerfScope } from './own-service-lines.seed.ts';
import {
  MAX_OWN_LINES_STATEMENTS,
  compactPlans,
  idListFilters,
  planViolations,
  statementsFor,
  type PlanNode,
  type Planned,
} from './own-service-lines.plans.ts';

// plan §5.3 البنود 1–3: موظفة بـ600 زيارة/602 سطراً، وزميلات في نفس النشاط بحجم `colleagues` سطراً.
export interface PerfConfig {
  colleagues: number;
  warm: number;
  background: number;
}
export interface Target {
  scope: PerfScope;
  her: string;
  oracle: string[];
  cancelled: ReadonlySet<string>;
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

const request = (t: Target, extra: Partial<OwnLinesRequest>): OwnLinesRequest => ({
  employeeId: t.her,
  month: '2026-10',
  cursor: undefined,
  limit: 20,
  allowed: ALL,
  branches: [{ id: t.scope.branchId, name_ar: null, name_en: 'Synthetic perf branch' }],
  timeZone: 'Asia/Kuwait',
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

type Timed = Awaited<ReturnType<typeof timed>>;
type Page = readonly [name: string, req: OwnLinesRequest, expected: string[]];

// الصفحات الأربع الأصلية بلا سطر ملغي (خمس جمل)، ثم ثلاث صفحات فيها سطر ملغي: جملة الإلغاءات السادسة، وهي الحد الأقصى.
function pagesOf(t: Target, primed: OwnLinesPage): Page[] {
  const at = (index: number) => must(t.oracle[index]);
  const page = (name: string, limit: number, after: string | undefined, from: number, to: number) =>
    [name, request(t, { limit, cursor: after }), t.oracle.slice(from, to)] as const;
  return [
    page('first-20', 20, undefined, 0, 20),
    page('first-100', 100, undefined, 0, 100),
    page('cursor-100', 100, must(primed.next_cursor), 100, 200),
    page('deep-cursor-100', 100, at(299), 300, 400),
    page('cancelled-20', 20, at(240), 241, 261),
    page('cancelled-100', 100, at(199), 200, 300),
    page('cancelled-deep-100', 100, at(399), 400, 500),
  ];
}

// يتحقق من محتوى الصفحة المقاسة ومن عدد جملها المتوقع، ويرجع المخالفات.
function pageViolations(label: string, name: string, t: Target, run: Timed, expected: string[]) {
  expect(run.page.items.map((item) => item.line_id)).toEqual(expected);
  const cancelledIds = expected.filter((lineId) => t.cancelled.has(lineId));
  expect(
    run.page.items.filter((item) => item.cancelled).map((item) => item.line_id),
    `${label} ${name}`,
  ).toEqual(cancelledIds);
  for (const item of run.page.items)
    if (item.cancelled) expect(item.cancelled_at).toEqual(expect.any(String));
  const wanted = statementsFor({ names: true, cancelled: cancelledIds.length > 0 });
  return run.statements === wanted
    ? []
    : [`${label} ${name}: ${run.statements} statements, expected ${wanted}`];
}

async function samplePages(
  f: TipFixture,
  label: string,
  t: Target,
  config: PerfConfig,
  violations: string[],
) {
  const primed = await timed(f, t, request(t, { limit: 100 }));
  const observed = new Set<number>();
  for (const [name, req, expected] of pagesOf(t, primed.page))
    for (let sample = 0; sample <= config.warm; sample++) {
      const run = await timed(f, t, req);
      const sampleName = sample === 0 ? 'first-run' : `warm-${sample}`;
      console.info(
        '57-2b measurement',
        JSON.stringify({
          label,
          page: name,
          sample: sampleName,
          elapsed_ms: run.elapsed,
          statements: run.statements,
          heap_delta_bytes: run.heap,
          rss_delta_bytes: run.rss,
        }),
      );
      observed.add(run.statements);
      violations.push(...pageViolations(label, name, t, run, expected));
      if (run.elapsed >= 200) violations.push(`${label} ${name} ${sampleName}: ${run.elapsed} ms`);
    }
  if (Math.max(...observed) !== MAX_OWN_LINES_STATEMENTS)
    violations.push(`${label}: no page ran the maximum ${MAX_OWN_LINES_STATEMENTS} statements`);
}

export async function measure(
  f: TipFixture,
  label: string,
  t: Target,
  config: PerfConfig,
  violations: string[],
) {
  await f.db.withTenant(f.otherCompany, (tx) => tx.execute(sql`SELECT 1`));
  await samplePages(f, label, t, config, violations);
  const plain = statementsFor({ names: true, cancelled: false });
  const firstPlans = await planned(f, t, request(t, { limit: 100 }));
  const deepPlans = await planned(f, t, request(t, { limit: 100, cursor: must(t.oracle[299]) }));
  const cancelledPlans = await planned(
    f,
    t,
    request(t, { limit: 100, cursor: must(t.oracle[199]) }),
  );
  console.info(
    '57-2b plans',
    JSON.stringify({
      label,
      plans: compactPlans([...firstPlans, ...deepPlans]),
      cancelled_page_plans: compactPlans(cancelledPlans),
    }),
  );
  console.info(
    '57-2b item-3b',
    JSON.stringify({
      label,
      id_list_as_filter: idListFilters([...firstPlans, ...deepPlans, ...cancelledPlans]),
    }),
  );
  violations.push(
    ...planViolations(label, firstPlans, plain),
    ...planViolations(label, deepPlans, plain),
    ...planViolations(label, cancelledPlans, MAX_OWN_LINES_STATEMENTS),
  );
}
