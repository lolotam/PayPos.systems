import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  must,
  recordVisit,
  tipFixture,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';
import { measure, type PerfConfig, type Target } from './own-service-lines.measure.ts';
import {
  bulkVisits,
  cancelColleagueLines,
  cancelPerfLines,
  homePerfScope,
  newPerfScope,
  secondLines,
  type PerfScope,
} from './own-service-lines.seed.ts';

export type { PerfConfig } from './own-service-lines.measure.ts';

// ثلاثة سطور ملغاة داخل الترتيب المرجعي لها. الموضع 50 يقع في الصفحة الأولى ذات المئة (0-99) وخارج الأولى ذات العشرين (0-19)
// وخارج صفحتي المؤشر الأصليتين (100-199، 300-399)، فتبقى «first-20» والمؤشرتان الأصليتان بخمس جمل وتصير «first-100» بست جمل؛
// والموضعان 250 و450 يقعان في صفحات المؤشر «الملغاة» (ست جمل). فالحد الأقصى (ست جمل) مقيس على صفحة أولى وعلى صفحة مؤشر.
const CANCELLED_AT = [50, 250, 450] as const;
// ويُلغى معها 47 سطراً لزميلاتها بالمسار الحقيقي نفسه، فيحمل جدول الإلغاءات خمسين صفاً في المستأجر الهدف لا ثلاثة.
const COLLEAGUE_CANCELLATIONS = 47;

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
  const ordered = await oracle(f, scope, her, config);
  const cancelled = CANCELLED_AT.map((index) => must(ordered[index]));
  await cancelPerfLines(f, scope, cancelled);
  await cancelColleagueLines(f, scope, her, COLLEAGUE_CANCELLATIONS);
  return { scope, her, oracle: ordered, cancelled: new Set(cancelled) };
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
