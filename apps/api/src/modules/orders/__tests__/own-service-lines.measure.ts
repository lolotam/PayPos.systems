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
import { MAX_OWN_LINES_STATEMENTS, statementsFor } from './own-service-lines.plans.ts';
import type { ExplainRow, TimedPlanned } from './own-service-lines.dbtime.ts';

// plan §5.3 البنود 1–3: موظفة بـ600 زيارة/602 سطراً، وزميلات في نفس النشاط بحجم `colleagues` سطراً.
export interface PerfConfig {
  colleagues: number;
  warm: number;
  background: number;
  // الحكم بـ200ms (AC-57-2b-9) على مجموع Execution Time في PostgreSQL لجمل الصفحة، في تشغيل الأداء الصريح فقط (قرار المالك 2026-11-23)؛
  // الزمن الكلي شاملاً السائق يُسجَّل تشخيصاً ولا يُحكَّم به، والتشغيل العادي يسجّل db-time بلا حكم.
  timing: boolean;
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

export const request = (t: Target, extra: Partial<OwnLinesRequest>): OwnLinesRequest => ({
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
export async function timed(f: TipFixture, t: Target, req: OwnLinesRequest) {
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

// كل جملة تُشرح وتُنفَّذ بنفس معاملاتها داخل نفس لقطة القراءة (withTenant بخيار readOnly) التي يقرأ بها القارئ؛ تُسجَّل الخطة وExecution Time
// وPlanning Time من أعلى مستوى في ناتج EXPLAIN، والصفحة المرجعة لتتحقق منها الاختبارات.
// TIMING OFF (قرار المدير 2026-11-23): يوقف ساعة كل صف في كل node ويبقي إجمالي Execution Time للاستعلام؛
// تشغيل TIMING ON على 66,002 سطر سجّل مجاميع أعلى من الزمن الكلي لنفس الصفحات.
export async function planned(f: TipFixture, t: Target, req: OwnLinesRequest) {
  const plans: TimedPlanned = [];
  const page = await f.db.withTenant(
    t.scope.companyId,
    (tx) =>
      readOwnLinesPage(
        new Proxy(tx, {
          get: (target, property, receiver) =>
            property === 'execute'
              ? async (query: SQL) => {
                  const explained = await target.execute<ExplainRow>(
                    sql`EXPLAIN (ANALYZE, TIMING OFF, BUFFERS, FORMAT JSON) ${query}`,
                  );
                  const top = must(must(explained[0])['QUERY PLAN'][0]);
                  plans.push({
                    statement: dialect.sqlToQuery(query).sql,
                    plan: top.Plan,
                    executionMs: top['Execution Time'],
                    planningMs: top['Planning Time'],
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
  return { plans, page };
}

export type Timed = Awaited<ReturnType<typeof timed>>;
export type PageKind = 'first' | 'cursor';
export type Page = readonly [
  name: string,
  req: OwnLinesRequest,
  expected: string[],
  kind: PageKind,
];

// الصفحة الأولى بلا مؤشر وصفحة المؤشر بعدها؛ الحد الأقصى (ست جمل) مطلوب على النوعين معاً، وكذلك الخمس.
// الصفحتان الأوليان: «first-20» بخمس جمل، و«first-100» فيها السطر الملغى في الموضع 50 فهي بست؛ صفحتا المؤشر الأصليتان بخمس،
// وصفحات «cancelled-*» فيها السطران الملغيان في الموضعين 250 و450 فهي بست.
export function pagesOf(t: Target, primed: OwnLinesPage): Page[] {
  const at = (index: number) => must(t.oracle[index]);
  const page = (name: string, limit: number, after: string | undefined, from: number, to: number) =>
    [
      name,
      request(t, { limit, cursor: after }),
      t.oracle.slice(from, to),
      after === undefined ? 'first' : 'cursor',
    ] as const;
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

// النوعان معاً يجب أن يمرّا بخمس وبست جمل في هذه الحالة الإحصائية، وإلا لقاس التشغيل الزمني الحد الأقصى على نوع واحد فقط
// مع أن قرار القبول يطلب صفحة أولى وصفحة مؤشر (AC-57-2b-9). الشرط على العدد المرصود لا على اسم الصفحة.
export function kindViolations(
  label: string,
  observed: ReadonlyMap<PageKind, ReadonlySet<number>>,
) {
  const found: string[] = [];
  for (const kind of ['first', 'cursor'] as const)
    for (const wanted of [MAX_OWN_LINES_STATEMENTS - 1, MAX_OWN_LINES_STATEMENTS])
      if (!observed.get(kind)?.has(wanted))
        found.push(`${label}: no ${kind} page ran exactly ${wanted} statements`);
  return found;
}

// يتحقق من محتوى الصفحة المقاسة ومن عدد جملها المتوقع، ويرجع المخالفات.
export function pageViolations(
  label: string,
  name: string,
  t: Target,
  run: Pick<Timed, 'page' | 'statements'>,
  expected: string[],
) {
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
