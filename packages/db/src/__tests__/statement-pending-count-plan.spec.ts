import { COMMISSION_INPUT_EVENT_TYPES } from '@pospay/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pendingCountHarness } from '../../test/statement-pending-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

// ADR-0012 §4 المجموعة 7 (CM-39): الخطة تُقاس على استعلام الدالة المثبّتة نفسه، بدور القارئ وبـ RLS، لا على نسخة مكتوبة يدويًا.
// المقياس عدد الصفوف المفحوصة مقابل ما فيه من بيانات، لا زمنًا بالميلي ثانية (PP-165).
const { A, B } = TENANT;
const FN = 'public.statement_pending_commission_events(timestamptz)';
const INDEX = 'outbox_commission_pending_count_idx';
const BEFORE_CUTOFF = 120;
const AFTER_CUTOFF = 30_000;

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}

let test: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;
const { asApp, pending } = pendingCountHarness(
  () => owner,
  () => app,
);

beforeAll(async () => {
  test = await createTestDatabase();
  await seedTwoTenants(test.ownerUrl);
  owner = postgres(test.ownerUrl, { max: 1, onnotice: () => undefined });
  app = postgres(test.appUrl, { max: 1, onnotice: () => undefined });
  // الصفوف القليلة قبل قطع الاعتماد، والكثيرة بعده من الأنواع الستة نفسها، حتى يفرّق المخطط بين فهرس يقف عند القطع وفهرس يقرأ كل أحداث الشركة.
  const types = COMMISSION_INPUT_EVENT_TYPES;
  await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, created_at)
    SELECT ${A.company}, gen_random_uuid(), 'service_session', gen_random_uuid(), 'ServiceLineChanged', '{}'::jsonb, '2026-01-01'
    FROM generate_series(1, ${BEFORE_CUTOFF}::int)`;
  await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, created_at)
    SELECT ${A.company}, gen_random_uuid(), 'service_session', gen_random_uuid(),
      (${[...types]}::text[])[1 + (g % ${types.length}::int)], '{}'::jsonb, '2099-01-01'
    FROM generate_series(1, ${AFTER_CUTOFF}::int) AS g`;
  await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, created_at)
    SELECT c, gen_random_uuid(), 'order', gen_random_uuid(), 'OrderCompleted', '{}'::jsonb, '2099-01-01'
    FROM unnest(ARRAY[${A.company}, ${B.company}]::uuid[]) AS c, generate_series(1, 25000)`;
  await owner`ANALYZE outbox`;
}, 120_000);

afterAll(async () => {
  await app.end();
  await owner.end();
  await test.drop();
});

/** استعلام العدّ كما هو مكتوب في الدالة المثبّتة، بمعاملَيها مستبدلين: الشركة A وتوقيت المعاملة. */
async function installedQuery(): Promise<string> {
  const [fn] = await owner`SELECT pg_get_functiondef(${FN}::regprocedure) AS def`;
  const body = /RETURN \(([\s\S]*?)\);\s*END/.exec(fn?.['def'] as string)?.[1];
  if (body === undefined) throw new Error('the installed function has no RETURN (...) query');
  return body
    .replace(/\bapproval_started_at\b/g, 'transaction_timestamp()')
    .replace(/\btenant\b/g, `'${A.company}'::uuid`);
}

class PlanCaptured extends Error {
  readonly plan: PlanNode;

  constructor(plan: PlanNode) {
    super('plan captured; the transaction is rolled back');
    this.plan = plan;
  }
}

/** يقيس خطة الاستعلام بدور القارئ وسياق الشركة A؛ dropIndex يحذف الفهرس داخل المعاملة ثم تُلغى كلها. */
async function planAsReader(dropIndex: boolean): Promise<PlanNode[]> {
  const query = await installedQuery();
  const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];
  try {
    await owner.begin(async (tx) => {
      if (dropIndex) await tx.unsafe(`DROP INDEX ${INDEX}`);
      await tx`SET LOCAL ROLE pospay_approval_reader`;
      await tx`SELECT set_config('app.company_id', ${A.company}, true)`;
      const [row] = await tx.unsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`);
      throw new PlanCaptured((row?.['QUERY PLAN'] as { Plan: PlanNode }[])[0]?.Plan as PlanNode);
    });
  } catch (error) {
    if (error instanceof PlanCaptured) return flatten(error.plan);
    throw error;
  }
  throw new Error('unreachable: the plan transaction always rolls back');
}

/** الصفوف التي فحصتها عقد القراءة من outbox، مع ما أُسقط بالفلتر، مضروبة في مرات التكرار. */
const examined = (nodes: PlanNode[]): number =>
  nodes
    .filter((node) => node['Relation Name'] === 'outbox')
    .reduce(
      (sum, node) =>
        sum + (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0)) * node['Actual Loops'],
      0,
    );

describe('group 7: the plan of the installed query under the reader role', () => {
  it('counts the large tenant exactly through the function', async () => {
    expect(await asApp(A.company, (tx) => pending(tx))).toBe(String(BEFORE_CUTOFF));
  });

  it('reads through the new index, bounds it by the cutoff, and examines only rows before the cutoff', async () => {
    const nodes = await planAsReader(false);
    const used = nodes.filter((node) => node['Index Name'] === INDEX);

    expect(used.length).toBeGreaterThan(0);
    expect(used.map((node) => node['Index Cond']).join(' ')).toMatch(/created_at < /);
    expect(
      nodes.some((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'outbox'),
    ).toBe(false);
    expect(examined(nodes)).toBeLessThanOrEqual(BEFORE_CUTOFF * 2);
  });

  // بدون الفهرس نفس الاستعلام يقرأ كل أحداث الأنواع الستة بعد القطع أيضًا؛ هذا يثبت أن اختبار الفهرس أعلاه يفشل لو حُذف.
  it('without the new index the same query examines far more rows, so the assertion above detects its removal', async () => {
    const nodes = await planAsReader(true);

    expect(nodes.some((node) => node['Index Name'] === INDEX)).toBe(false);
    expect(examined(nodes)).toBeGreaterThan(BEFORE_CUTOFF * 10);
  });
});
