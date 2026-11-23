import { appendFileSync } from 'node:fs';
import type { OwnServiceLines } from '@pospay/contracts';
import { nodes, type PlanNode, type Planned } from './own-service-lines.plans.ts';

// قرار المالك 2026-11-23: القبول على زمن تنفيذ PostgreSQL المقاس (`Execution Time` من EXPLAIN ANALYZE) مجموعاً على جمل الصفحة،
// لا على الزمن الكلي شاملاً السائق. الحد 200ms على مجموع Execution Time وحده، ويُسجَّل معه Planning Time ومجموعهما كي يرى القارئ الرقمين.
export const JUDGED_EXECUTION_MS = 200;
// عدد مرات شرح كل صفحة مُحكَّمة؛ كل عينة تُحكَّم (لا أفضل عينة).
export const DB_TIME_SAMPLES = 3;

// سطر قياس واحد: يُطبع بالـconsole، ولو حُدّد POSPAY_57_2B_OUT يُلحَق بالملف كمان. vitest بيخبّي مخرجات الاختبارات الناجحة، فبدون الملف
// أرقام التشغيل الناجح بتضيع. الصيغة `<tag> <json>` سطر لكل قياس.
export function record(tag: string, json: string) {
  console.info(tag, json);
  const out = process.env['POSPAY_57_2B_OUT'];
  if (out)
    appendFileSync(
      out,
      `${tag} ${json}
`,
    );
}

export type TimedPlanned = (Planned[number] & { executionMs: number; planningMs: number })[];
export type ExplainRow = {
  'QUERY PLAN': { Plan: PlanNode; 'Planning Time': number; 'Execution Time': number }[];
};
export type DbTimeKind = 'first' | 'cursor';
export interface DbTimePage {
  name: string;
  kind: DbTimeKind;
  expected: string[];
  run: () => Promise<{ plans: TimedPlanned; page: OwnServiceLines }>;
}

const total = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0);
// المجاميع مقرّبة لست خانات في السجل فقط؛ الحكم يجري على القيمة الخام.
const rounded = (value: number) => Math.round(value * 1000) / 1000;

// الاسم: ترتيب الجملة في الصفحة مع الجدول الذي تقرؤه، فمجموعات الست جمل تُقرأ جملةً جملة.
export function perStatement(plans: TimedPlanned) {
  return plans.map(({ plan, executionMs, planningMs }, index) => {
    const all = nodes(plan);
    return {
      name: `${index + 1}:${all.find((node) => node['Relation Name'])?.['Relation Name'] ?? 'none'}`,
      execution_ms: rounded(executionMs),
      planning_ms: rounded(planningMs),
      rows: plan['Actual Rows'],
      loops: plan['Actual Loops'],
      rows_removed_by_filter: total(all.map((node) => node['Rows Removed by Filter'] ?? 0)),
      shared_hit: plan['Shared Hit Blocks'],
      shared_read: plan['Shared Read Blocks'],
    };
  });
}

export function sums(plans: TimedPlanned) {
  const execution = total(plans.map((entry) => entry.executionMs));
  const planning = total(plans.map((entry) => entry.planningMs));
  return { execution, planning };
}

// يشرح كل صفحة DB_TIME_SAMPLES مرة (مرة واحدة في التشغيل غير المحكَّم)، ويسجّل سطر JSON لكل عينة، ويحكم بكل عينة على حدة
// لما `judged`: مجموع Execution Time < 200ms. العينة التي تبلغ الحد تُسجَّل مخالفة ولا يُعاد التشغيل ليخضرّ.
export async function sampleDbTime(
  label: string,
  pages: readonly DbTimePage[],
  options: {
    judged: boolean;
    check: (
      name: string,
      plans: TimedPlanned,
      page: OwnServiceLines,
      expected: string[],
    ) => string[];
  },
  violations: string[],
) {
  const observed = new Map<DbTimeKind, Set<number>>([
    ['first', new Set()],
    ['cursor', new Set()],
  ]);
  const samples = options.judged ? DB_TIME_SAMPLES : 1;
  for (const entry of pages)
    for (let sample = 1; sample <= samples; sample++) {
      const { plans, page } = await entry.run();
      const { execution, planning } = sums(plans);
      record(
        '57-2b db-time',
        JSON.stringify({
          label,
          page: entry.name,
          sample,
          kind: entry.kind,
          statements: plans.length,
          execution_ms_sum: rounded(execution),
          planning_ms_sum: rounded(planning),
          execution_plus_planning_ms_sum: rounded(execution + planning),
          per_statement: perStatement(plans),
        }),
      );
      observed.get(entry.kind)?.add(plans.length);
      violations.push(...options.check(entry.name, plans, page, entry.expected));
      if (options.judged && execution >= JUDGED_EXECUTION_MS)
        violations.push(
          `${label} ${entry.name} db-time sample ${sample}: execution ${execution} ms >= ${JUDGED_EXECUTION_MS}`,
        );
    }
  return observed;
}
