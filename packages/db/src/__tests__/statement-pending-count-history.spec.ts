import { COMMISSION_INPUT_EVENT_TYPES, COMMISSION_INPUTS_CONSUMER_ID } from '@pospay/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closePendingCountTest,
  pendingCountHarness,
} from '../../test/statement-pending-fixtures.ts';
import {
  examined,
  planAsReader,
  seqScansOutbox,
  type MeasuredPlan,
} from '../../test/statement-pending-plans.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

// ADR-0012 §4 المجموعة 7 (CM-39): الحمل الواقعي — شركة لها تاريخ كبير قبل قطع الاعتماد عولج كله وسُجّلت علاماته، والعدّ يرجع صفرًا.
// الاستعلام يمرّ على كل هذا التاريخ قبل القطع (الأحداث المعالَجة تُستبعد بالـ anti-join لا بالفهرس)، فالقياس يُطبع بالأرقام ولا يُضبط الفرش ليخفيها.
// الخطة الفعلية لا تُفترض: تُطبع كما اختارها المخطط، والاختبار يؤكد فقط ما هو صحيح لكل خطة مقبولة (CS-Q56: لا فهرس مخصص للعدّاد).
const { A, B } = TENANT;
const HISTORY = 30_000;
const NOISE = 25_000;

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
  const types = COMMISSION_INPUT_EVENT_TYPES;
  // نفس تاريخ الأنواع الستة لكلا الشركتين: وجود تاريخ B يثبت أن خطة القراءة من outbox تبقى محدودة بتاريخ A وحده (examined <= HISTORY).
  await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, created_at)
    SELECT c, gen_random_uuid(), 'service_session', gen_random_uuid(),
      (${[...types]}::text[])[1 + (g % ${types.length}::int)], '{}'::jsonb, '2026-01-01'
    FROM unnest(ARRAY[${A.company}, ${B.company}]::uuid[]) AS c, generate_series(1, ${HISTORY}::int) AS g`;
  await owner`INSERT INTO consumed_events (company_id, consumer_id, event_id)
    SELECT company_id, ${COMMISSION_INPUTS_CONSUMER_ID}, id FROM outbox
    WHERE company_id IN (${A.company}, ${B.company})`;
  await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, created_at)
    SELECT c, gen_random_uuid(), 'order', gen_random_uuid(), 'OrderCompleted', '{}'::jsonb, '2026-01-01'
    FROM unnest(ARRAY[${A.company}, ${B.company}]::uuid[]) AS c, generate_series(1, ${NOISE}::int)`;
  await owner`ANALYZE outbox`;
  await owner`ANALYZE consumed_events`;
}, 180_000);

afterAll(async () => closePendingCountTest(test, owner, app));

const report = (label: string, plan: MeasuredPlan): void => {
  console.info('statement-pending-count.measured', {
    case: label,
    history: HISTORY,
    outboxRowsExamined: examined(plan.nodes),
    executionMs: plan.executionMs,
    recheckRemoved: plan.nodes.map((node) => node['Rows Removed by Index Recheck'] ?? 0),
    heapBlocks: plan.nodes
      .filter(
        (node) =>
          node['Exact Heap Blocks'] !== undefined || node['Lossy Heap Blocks'] !== undefined,
      )
      .map((node) => ({ exact: node['Exact Heap Blocks'], lossy: node['Lossy Heap Blocks'] })),
    nodes: plan.nodes.map((node) => [
      node['Node Type'],
      node['Index Name'] ?? node['Relation Name'],
    ]),
  });
};

describe('group 7: a large, fully processed history before the cutoff', () => {
  it('counts zero through the function', async () => {
    expect(await asApp(A.company, (tx) => pending(tx))).toBe('0');
  });

  // الادعاءات الصادقة فقط: لا مسح تسلسلي على outbox، والصفوف المفحوصة لا تتجاوز التاريخ ذا الأنواع الستة،
  // أي أن صفوف الأنواع الأخرى (25,000 لكل شركة) مستبعدة. أي فهرس يختاره المخطط يُطبع في الخطة لا يُفترض.
  it.each([
    { label: 'custom plan with the cutoff as a constant', generic: false },
    { label: 'forced generic plan, prepared with the two parameters', generic: true },
  ])(
    'reads only the six-type history of the tenant, with no sequential scan of outbox: $label',
    async ({ label, generic }) => {
      const plan = await planAsReader(owner, { tenant: A.company, generic });
      report(label, plan);
      // القياس العام يحضّر عبارة باسم pending_q؛ لازم ما تفضلش معلّقة في جلسة الـ owner بعد ما القياس يخلص (#1240).
      const prepared =
        await owner`SELECT count(*)::int AS n FROM pg_prepared_statements WHERE name = 'pending_q'`;
      expect(prepared).toEqual([{ n: 0 }]);

      expect(seqScansOutbox(plan.nodes)).toBe(false);
      expect(examined(plan.nodes)).toBeLessThanOrEqual(HISTORY);
    },
  );
});
