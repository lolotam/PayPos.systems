import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  must,
  recordVisit,
  tipFixture,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';
import type { PerfConfig, Target } from './own-service-lines.measure.ts';
import { record } from './own-service-lines.dbtime.ts';
import { isStatisticsDependentFailure } from './own-service-lines.retry.ts';
import { measureDiagnostics, measureJudged } from './own-service-lines.phases.ts';
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
// زميلاتها المزروعون قبل إلغاء الـ47: يكفوا لاختيارهم، وأقل من عتبة autoanalyze (50 + 10% من الصفوف) للجداول الثلاثة.
const EARLY_COLLEAGUES = 100;
// محاولات تأسيس الحالة القديمة: autoanalyze بيحلّل الجداول خلال دقيقة تقريباً من الزرع، فتُرفض المحاولة اللي حدث فيها تحليل (بصمة الـANALYZE).
// كل محاولة بعد الأولى على قاعدة جديدة مستنسخة وتزرع هدفها بالحجم الموثّق نفسه، فالمحاولات المرفوضة ما بتتراكمش مستأجرين كبار
// في الجداول (وإلا الجدول بيكبر مع كل إعادة والمحاولة المقبولة تتقاس على حجم غير الموثّق).
const MAX_ATTEMPTS = 5;
// شركتا خلفية تكبّران الجداول لحجم موثّق ثم ANALYZE: الإحصاءات بعدها تعرف الشركات الصغيرة فقط، فالهدف الجديد يبقى غائباً من MCV.
async function prepareBackground(f: TipFixture, config: PerfConfig) {
  for (let n = 0; n < 2; n++) {
    const background = await newPerfScope(f, `Synthetic perf background ${n}`);
    await bulkVisits(f, background, config.background, background.employeeIds.slice(1));
  }
  await f.h.owner.unsafe('ANALYZE service_sessions,service_lines,line_performers');
}

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

// بصمة آخر ANALYZE وautoanalyze للجداول الثلاثة؛ غياب الشركة من قوائم MCV لا يكفي وحده دليلاً على بقاء الإحصاءات قديمة، فقد يجري
// autoanalyze أثناء الزرع والمستأجر لسه أقل من أن يظهر في القوائم. القبول يشترط تطابق البصمة قبل الزرع وقبل القياس وبعده.
const stamps = (rows: readonly Record<string, unknown>[]) =>
  JSON.stringify(
    rows.map((row) => [row['tablename'], row['last_analyze'], row['last_autoanalyze']]),
  );

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
  record(
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
  const others = scope.employeeIds.slice(1);
  // الإلغاءات الـ47 بالمسار الحقيقي (معاملة لكل واحد) أبطأ جزء في الزرع، فتتم والمستأجر لسه صغير (أقل من عتبة autoanalyze) ثم تدخل الدفعات
  // الكبيرة بسرعة؛ فالنافذة بين العتبة والقياس المُحكَّم قصيرة. الصفوف والمحتوى نفسهم، والترتيب فقط هو اللي اتغير.
  const colleagueBulk = home ? config.colleagues : config.colleagues - 1;
  await bulkVisits(f, scope, EARLY_COLLEAGUES, others);
  await cancelColleagueLines(f, scope, her, COLLEAGUE_CANCELLATIONS);
  await bulkVisits(f, scope, colleagueBulk - EARLY_COLLEAGUES, others);
  await bulkVisits(f, scope, home ? 599 : 600, [her]);
  await secondLines(f, scope, her, 2);
  const ordered = await oracle(f, scope, her, config);
  const cancelled = CANCELLED_AT.map((index) => must(ordered[index]));
  await cancelPerfLines(f, scope, cancelled);
  return { scope, her, oracle: ordered, cancelled: new Set(cancelled) };
}

export function perfSuite(config: PerfConfig) {
  let f: TipFixture;
  let target: Target | null = null;
  beforeAll(async () => {
    f = await tipFixture();
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });

  it('stale statistics: a new tenant absent from the three MCV lists, no ANALYZE after its insert (AC 1, 3)', async () => {
    // لكل حالة قائمة مخالفاتها: مخالفة في الإحصاءات القديمة لا تُحسب مرة ثانية على الحالة العادية.
    const violations: string[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS && target === null; attempt++) {
      if (attempt > 0) {
        await f.close();
        f = await tipFixture();
      }
      await prepareBackground(f, config);
      const baseline = stamps((await statistics(f, '')).rows);
      const candidate = await seedTarget(f, 0, config);
      const before = await statistics(f, candidate.scope.companyId);
      if (!before.absent || stamps(before.rows) !== baseline) continue;
      record('57-2b statistics before', JSON.stringify({ attempt, rows: before.rows }));
      // المرحلة المُحكَّمة أولاً والإحصاءات لسه قديمة؛ والتحقق منها بعدها مباشرة، قبل التشخيص الطويل بالزمن الكلي.
      // autoanalyze بين الزرع والقياس ممكن يغيّر الخطة لحد المهلة، فإلغاء الجملة بالمهلة بس معناه محاولة مرفوضة؛ أي خطأ تاني
      // (مقارنة بالمرجع وغيرها) بيطلع فوراً حتى لو الإحصاءات اتغيّرت.
      const pages = await measureJudged(f, 'stale statistics', candidate, config, violations).catch(
        async (error: unknown) => {
          if (!isStatisticsDependentFailure(error)) throw error;
          const during = await statistics(f, candidate.scope.companyId);
          if (during.absent && stamps(during.rows) === baseline) throw error;
          return null;
        },
      );
      const after = await statistics(f, candidate.scope.companyId);
      record('57-2b statistics after', JSON.stringify({ attempt, rows: after.rows }));
      if (pages === null || !after.absent || stamps(after.rows) !== baseline) {
        violations.length = 0;
        continue;
      }
      target = candidate;
      await measureDiagnostics(f, 'stale statistics', candidate, config, violations, pages);
      const last = await statistics(f, candidate.scope.companyId);
      record('57-2b statistics after diagnostics', JSON.stringify({ attempt, rows: last.rows }));
    }
    expect(target, 'a tenant absent from every MCV list could not be established').not.toBeNull();
    expect(violations).toEqual([]);
  }, 1_800_000);

  it('normal statistics: the same fixture after ANALYZE prepared only this run (AC 2, 3)', async () => {
    // الحالة العادية لا تعتمد على الحالة القديمة: لو شُغّلت وحدها (تصفية بالاسم) تزرع هدفها بنفسها.
    const violations: string[] = [];
    const t = target ?? (await seedTarget(f, 99, config));
    await f.h.owner.unsafe('ANALYZE service_sessions,service_lines,line_performers');
    const normal = await statistics(f, t.scope.companyId);
    record('57-2b statistics normal', JSON.stringify(normal.rows));
    const pages = await measureJudged(f, 'normal statistics', t, config, violations);
    await measureDiagnostics(f, 'normal statistics', t, config, violations, pages);
    expect(violations).toEqual([]);
  }, 1_800_000);
}
