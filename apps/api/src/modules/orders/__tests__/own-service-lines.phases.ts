import { sql } from 'drizzle-orm';
import { must, type TipFixture } from '../../../../test/session-tips.fixture.ts';
import { record, sampleDbTime } from './own-service-lines.dbtime.ts';
import {
  kindViolations,
  pagesOf,
  pageViolations,
  planned,
  request,
  timed,
  type Page,
  type PageKind,
  type PerfConfig,
  type Target,
} from './own-service-lines.measure.ts';
import { compactPlans, idListFilters, planViolations } from './own-service-lines.plans.ts';

// حالة جدول الإلغاءات وقت الخطط: صفوفه، وهل حلّله autovacuum؛ تُسجَّل ليُقرأ بها أي Seq Scan عليه، وتحدد إعفاءه من شرطَي
// الفهرس و«لا Seq Scan» (جدول صغير محلَّل يختار له المخطط Seq Scan بحق؛ الجداول الثلاثة الأخرى ما بتتعفاش).
async function cancellationTable(f: TipFixture, t: Target) {
  const [row] = await f.h.owner`SELECT
    (SELECT count(*)::int FROM service_line_cancellations WHERE company_id=${t.scope.companyId}) AS tenant_rows,
    c.reltuples::float8 AS reltuples, s.n_live_tup, s.n_mod_since_analyze, s.last_analyze, s.last_autoanalyze
    FROM pg_class c JOIN pg_stat_all_tables s ON s.relid=c.oid
    WHERE c.relname='service_line_cancellations' AND c.relnamespace='public'::regnamespace`;
  return row;
}

// خطط الصفحات الثلاث الممثِّلة (الأولى والمؤشر العميق والملغاة): تُسجَّل وتُفحص فحوص البند 3 (أ) وتُسجَّل جمل قوائم المعرفات (ب).
async function checkPlans(f: TipFixture, label: string, t: Target, violations: string[]) {
  const plain = { names: true, cancelled: false };
  const maximum = { names: true, cancelled: true };
  const table = await cancellationTable(f, t);
  record('57-2b cancellations table', JSON.stringify(table));
  const tolerance = {
    cancellationsAnalysed: table?.['last_analyze'] != null || table?.['last_autoanalyze'] != null,
  };
  const { plans: firstPlans } = await planned(f, t, request(t, { limit: 100 }));
  const { plans: deepPlans } = await planned(
    f,
    t,
    request(t, { limit: 100, cursor: must(t.oracle[299]) }),
  );
  const { plans: cancelledPlans } = await planned(
    f,
    t,
    request(t, { limit: 100, cursor: must(t.oracle[199]) }),
  );
  record(
    '57-2b plans',
    JSON.stringify({
      label,
      plans: compactPlans([...firstPlans, ...deepPlans]),
      cancelled_page_plans: compactPlans(cancelledPlans),
    }),
  );
  record(
    '57-2b item-3b',
    JSON.stringify({
      label,
      id_list_as_filter: idListFilters([...firstPlans, ...deepPlans, ...cancelledPlans]),
    }),
  );
  violations.push(
    ...planViolations(label, firstPlans, maximum, tolerance),
    ...planViolations(label, deepPlans, plain, tolerance),
    ...planViolations(label, cancelledPlans, maximum, tolerance),
  );
}

// المرحلة المُحكَّمة، وهي التي لازم تتم كلها والإحصاءات لسه قديمة: قياس db-time (الحكم)، ثم فحوص الخطط. الترتيب مقصود: autovacuum
// بيحلّل الجداول الثلاثة خلال دقيقة تقريباً من الزرع، فلو سبقها التشخيص الطويل بالزمن الكلي لما بقيت الحالة القديمة صالحة.
// المنتظر من المستدعي أن يتحقق من الإحصاءات بعد هذه الدالة مباشرة، قبل التشخيص.
export async function measureJudged(
  f: TipFixture,
  label: string,
  t: Target,
  config: PerfConfig,
  violations: string[],
): Promise<Page[]> {
  await f.db.withTenant(f.otherCompany, (tx) => tx.execute(sql`SELECT 1`));
  const primed = await timed(f, t, request(t, { limit: 100 }));
  const pages = pagesOf(t, primed.page);
  // الحكم: مجموع Execution Time في PostgreSQL لجمل كل صفحة، كل عينة على حدة، في التشغيل الصريح فقط (قرار المالك 2026-11-23).
  // Planning Time يُسجَّل بجانبه ولا يدخل في الحكم؛ الزمن الكلي في measureDiagnostics تشخيص فقط.
  const observed = await sampleDbTime(
    label,
    pages.map(([name, req, expected, kind]) => ({
      name,
      kind,
      expected,
      run: () => planned(f, t, req),
    })),
    {
      judged: config.timing,
      check: (name, plans, page, expected) =>
        pageViolations(label, name, t, { page, statements: plans.length }, expected),
    },
    violations,
  );
  violations.push(...kindViolations(`${label} db-time`, observed));
  await checkPlans(f, label, t, violations);
  return pages;
}

// تشخيص بالزمن الكلي (شاملاً begin/commit والسائق): يُسجَّل ولا يُحكَّم به (قرار المالك 2026-11-23)، ويتحقق فقط من صحة الصفحات
// وعدد جملها. بيجي بعد المرحلة المُحكَّمة، فممكن تكون الإحصاءات اتحدّثت خلاله في الحالة القديمة.
export async function measureDiagnostics(
  f: TipFixture,
  label: string,
  t: Target,
  config: PerfConfig,
  violations: string[],
  pages: readonly Page[],
) {
  const observed = new Map<PageKind, Set<number>>([
    ['first', new Set()],
    ['cursor', new Set()],
  ]);
  for (const [name, req, expected, kind] of pages)
    for (let sample = 0; sample <= config.warm; sample++) {
      const run = await timed(f, t, req);
      const sampleName = sample === 0 ? 'first-run' : `warm-${sample}`;
      record(
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
      observed.get(kind)?.add(run.statements);
      violations.push(...pageViolations(label, name, t, run, expected));
    }
  violations.push(...kindViolations(label, observed));
}
