import { lockStatementPeriods } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { commissionBlockedCorrectionsStatement } from '../queries/commission-blocked-corrections.query.ts';
import {
  closeCommissionFixture,
  commissionPlanVersionsFixture,
  ids,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';

let f: CommissionPlanFixture;
let seededStatementId = '';
beforeAll(async () => {
  f = await commissionPlanVersionsFixture();
  await f.db.withTenant(f.company, async (tx) => {
    const [locked] = await lockStatementPeriods(tx, {
      businessId: f.business,
      periods: ['2026-11'],
      ids,
    });
    if (locked === undefined) throw new Error('the target statement row is missing after its lock');
    seededStatementId = locked.statementId;
  });
  // موظفات الزرع: عشرون موظفة × عشرة شهور = 200 صف مفتوح، كل موظفة وشهر لها صف واحد بس
  // (القيد الجزئي بيمنع صفين مفتوحين لنفس الموظفة والشهر).
  await f.h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${f.company},gen_random_uuid(),${f.business},${f.branch},
      'Explain employee ' || series,'explain-employee-' || series,'staff','2026-01-01',100 + series
    FROM generate_series(1, 20) AS series`;
  const seeded = await f.h.owner`INSERT INTO commission_blocked_corrections(
    company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
    target_statement_id,created_at)
    SELECT ${f.company},gen_random_uuid(),${f.business},e.id,
      to_char(date '2026-01-01' + (((series - 1) / 20) || ' month')::interval,'YYYY-MM'),
      'NO_PLAN',gen_random_uuid(),'2026-11',${seededStatementId},
      now() - (series || ' minutes')::interval
    FROM generate_series(1, 200) AS series
    JOIN employees e ON e.company_id=${f.company} AND e.business_id=${f.business}
      AND e.employee_number = 101 + ((series - 1) % 20)
    RETURNING id`;
  expect(seeded).toHaveLength(200);
  await f.h.owner`ANALYZE commission_blocked_corrections`;
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

async function explainPlan(
  status: 'open' | 'resolved' | 'all',
  cursor: { readonly createdAt: string; readonly id: string } | null,
): Promise<string> {
  let text = '';
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': unknown }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionBlockedCorrectionsStatement(
        { companyId: f.company, businessId: f.business, status },
        cursor,
        20,
      )}`,
    );
    text = JSON.stringify(row?.['QUERY PLAN']);
  });
  return text;
}

it('L2 the open list plan reads the table through the list index with no sort', async () => {
  const text = await explainPlan('open', null);
  expect(text).toContain('commission_blocked_corrections_list_idx');
  expect(text).not.toContain('"Node Type":"Seq Scan"');
  expect(text).not.toContain('"Node Type":"Sort"');
  expect(text).not.toContain('"Node Type":"Incremental Sort"');
});

it('L2 the keyset page keeps the index order past an anchor row', async () => {
  const text = await explainPlan('open', {
    createdAt: '2026-11-01T08:00:00.000000Z',
    id: ids.newId(),
  });
  expect(text).toContain('commission_blocked_corrections_list_idx');
  expect(text).not.toContain('"Node Type":"Seq Scan"');
  expect(text).not.toContain('"Node Type":"Sort"');
});

it('L2 the resolved status keeps an index; the all status keeps the list order with no sort', async () => {
  // صفوف المحلولة قليلة بالتصميم، فالمخطط مصرّح له ياخد فهرس الموظفة والترتيب فوقها؛
  // المطلوب مفيش مسح متسلسل في الحالتين، وترتيب الفهرس بيفضل محفوظ من غير Sort في all.
  const resolved = await explainPlan('resolved', null);
  expect(resolved).not.toContain('"Node Type":"Seq Scan"');
  const all = await explainPlan('all', null);
  expect(all).toContain('commission_blocked_corrections_list_idx');
  expect(all).not.toContain('"Node Type":"Seq Scan"');
  expect(all).not.toContain('"Node Type":"Sort"');
});

it('L2 the sparse open page uses an ordered index path through resolved history', async () => {
  // سيناريو تمثيلي صناعي: تاريخ محلول كثيف أحدث من الصفوف المفتوحة. الفهرس الحالي بيمسح
  // بالترتيب وبيفلتر كل صف محلول يعديه — الكلفة دي ظاهرة في المسح الفعلي بالأرقام، من غير
  // مسح متسلسل ولا فهرس جديد؛ فهرس واعي بالحالة بيحتاج قرار ترحيل منفصل مش في 55-2e.
  const seeded = await f.h.owner`INSERT INTO commission_blocked_corrections(
    company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
    target_statement_id,created_at,resolved_at,resolved_generation)
    SELECT ${f.company},gen_random_uuid(),${f.business},e.id,
      to_char(date '2026-01-01' + (((series - 1) % 10) || ' month')::interval,'YYYY-MM'),
      'NO_PLAN',gen_random_uuid(),'2026-11',${seededStatementId},
      now() + (series || ' seconds')::interval,
      now() + (series || ' seconds')::interval, 1
    FROM generate_series(1, 200) AS series
    JOIN employees e ON e.company_id=${f.company} AND e.business_id=${f.business}
      AND e.employee_number = 101 + ((series - 1) % 20)
    RETURNING id`;
  expect(seeded).toHaveLength(200);
  await f.h.owner`ANALYZE commission_blocked_corrections`;
  const text = await explainPlan('open', null);
  expect(text).toContain('"Index Name":');
  expect(text).not.toContain('"Node Type":"Sort"');
  expect(text).not.toContain('"Node Type":"Seq Scan"');
  const removed = (text.match(/"Rows Removed by Filter":(\d+)/g) ?? [])
    .map((entry) => Number(/(\d+)$/.exec(entry)?.[1] ?? 0))
    .reduce((max, value) => (value > max ? value : max), 0);
  expect(removed).toBeLessThanOrEqual(seeded.length);
});
