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

type Status = 'open' | 'resolved' | 'all';
type PlanNode = {
  'Node Type': string;
  'Index Name'?: string;
  'Relation Name'?: string;
  'Actual Rows': number;
  'Rows Removed by Filter'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: PlanNode[];
};

type Activity = { business: string; statementId: string };
type Page = { createdAt: string; id: string } | null;

let f: CommissionPlanFixture;
const activities: Record<string, Activity> = {};

function businessOf(name: string): string {
  const activity = activities[name];
  if (activity === undefined) throw new Error(`the sparse activity ${name} was not seeded`);
  return activity.business;
}

const EMPLOYEES = 40;
const PERIODS = 36;

// نشاط معزول بصفوفه: القيد الجزئي بيسمح بصف مفتوح واحد لكل موظفة وشهر، فالمفتوح محدود بـ 1440.
async function seedActivity(
  name: string,
  base: number,
  shape: { open: number; resolved: number; resolvedNewer: boolean },
): Promise<void> {
  const created = await f.h.send('POST', '/v1/businesses', {
    cookie: f.cookie,
    company: f.company,
    key: `sparse-${name}`,
    body: { vertical_type: 'salon', name_en: `Sparse ${name}`, timezone: 'Asia/Kuwait' },
  });
  const business = created.body['id'] as string;
  const branchResponse = await f.h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie: f.cookie,
    company: f.company,
    key: `sparse-branch-${name}`,
    body: { name_en: `Sparse branch ${name}` },
  });
  const branch = branchResponse.body['id'] as string;
  let statementId = '';
  await f.db.withTenant(f.company, async (tx) => {
    const [locked] = await lockStatementPeriods(tx, {
      businessId: business,
      periods: ['2026-11'],
      ids,
    });
    if (locked === undefined) throw new Error('the target statement row is missing after its lock');
    statementId = locked.statementId;
  });
  await f.h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${f.company},gen_random_uuid(),${business},${branch},
      'Sparse ' || ${name} || series,'sparse-' || ${name} || '-' || series,'staff','2026-01-01',${base} + series
    FROM generate_series(1, ${EMPLOYEES}) AS series`;
  // المفتوح والمحلول بيتزرعوا بنفس الجملة؛ الأقدم بفارق يوم كامل عن الأحدث عشان الترتيب واضح.
  const openAge = shape.resolvedNewer ? 86400 : 0;
  const resolvedAge = shape.resolvedNewer ? 0 : 86400;
  await seedRows(business, statementId, base, shape.open, openAge, false);
  await seedRows(business, statementId, base, shape.resolved, resolvedAge, true);
  activities[name] = { business, statementId };
}

async function seedRows(
  business: string,
  statementId: string,
  base: number,
  count: number,
  ageSeconds: number,
  resolved: boolean,
): Promise<void> {
  if (count === 0) return;
  await f.h.owner`INSERT INTO commission_blocked_corrections(
    company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
    target_statement_id,created_at,resolved_at,resolved_generation)
    SELECT ${f.company},gen_random_uuid(),${business},e.id,
      to_char(date '2023-01-01' + (((series - 1) / ${EMPLOYEES}) % ${PERIODS} || ' month')::interval,'YYYY-MM'),
      'NO_PLAN',gen_random_uuid(),'2026-11',${statementId},
      now() - (${ageSeconds} || ' seconds')::interval - (series || ' seconds')::interval,
      CASE WHEN ${resolved} THEN now() ELSE NULL END,
      CASE WHEN ${resolved} THEN 1 ELSE NULL END
    FROM generate_series(1, ${count}) AS series
    JOIN employees e ON e.company_id=${f.company} AND e.business_id=${business}
      AND e.employee_number = ${base} + 1 + ((series - 1) % ${EMPLOYEES})`;
}

beforeAll(async () => {
  f = await commissionPlanVersionsFixture();
  await seedActivity('sparse-open', 1000, { open: 100, resolved: 12000, resolvedNewer: true });
  await seedActivity('sparse-resolved', 2000, { open: 1000, resolved: 100, resolvedNewer: false });
  await seedActivity('empty-open', 3000, { open: 0, resolved: 12000, resolvedNewer: true });
  await seedActivity('empty-resolved', 4000, { open: 1000, resolved: 0, resolvedNewer: true });
  await f.h.owner`ANALYZE commission_blocked_corrections`;
}, 120_000);
afterAll(async () => {
  await closeCommissionFixture(f);
});

function collectBelowLimit(node: PlanNode): PlanNode[] {
  return (node.Plans ?? []).flatMap((child) => [child, ...collectBelowLimit(child)]);
}

async function measure(name: string, status: Status, cursor: Page) {
  let root: PlanNode | null = null;
  await f.db.withTenant(f.company, async (tx) => {
    const [row] = await tx.execute<{ 'QUERY PLAN': unknown }>(
      sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${commissionBlockedCorrectionsStatement(
        { companyId: f.company, businessId: businessOf(name), status },
        cursor,
        20,
      )}`,
    );
    const raw = row?.['QUERY PLAN'];
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { Plan: PlanNode }[];
    root = parsed[0]?.Plan ?? null;
  });
  if (root === null) throw new Error('EXPLAIN returned no plan');
  const plan: PlanNode = root;
  const below = collectBelowLimit(plan);
  return {
    plan,
    below,
    belowTypes: below.map((n) => n['Node Type']),
    removed: below.reduce((sum, n) => sum + (n['Rows Removed by Filter'] ?? 0), 0),
    buffers: (plan['Shared Hit Blocks'] ?? 0) + (plan['Shared Read Blocks'] ?? 0),
    scanned: below.filter((n) => n['Node Type'].includes('Scan')),
  };
}

type Measured = Awaited<ReturnType<typeof measure>>;

// موضع في الترتيب (الأحدث أولًا) لصف مفتوح أو محلول، بتوقيت بالميكروثانية زي مؤشر الصفحة بالظبط.
async function anchor(name: string, resolved: boolean, offset: number): Promise<Page> {
  const [row] = await f.h.owner`SELECT created_at::text AS created_at, id
    FROM commission_blocked_corrections
    WHERE company_id=${f.company} AND business_id=${businessOf(name)}
      AND (resolved_at IS NOT NULL)=${resolved}
    ORDER BY created_at DESC, id DESC OFFSET ${offset} LIMIT 1`;
  if (row === undefined) throw new Error('the cursor anchor row is missing');
  return { createdAt: row['created_at'] as string, id: row['id'] as string };
}

// الشكل المطلوب تحت Limit: مسح فهرس واحد مرتب بيغذّي Limit، من غير مسح متسلسل ولا ترتيب أسفله.
function expectOrderedIndexScanUnderLimit(m: Measured, rows: number, indexName?: string): void {
  expect(m.plan['Node Type']).toBe('Limit');
  expect(m.belowTypes).not.toContain('Seq Scan');
  expect(m.belowTypes).not.toContain('Sort');
  expect(m.belowTypes).not.toContain('Incremental Sort');
  expect(m.scanned).toHaveLength(1);
  const [scan] = m.scanned;
  expect(['Index Scan', 'Index Only Scan']).toContain(scan?.['Node Type']);
  expect(scan?.['Relation Name']).toBe('commission_blocked_corrections');
  if (indexName !== undefined) expect(scan?.['Index Name']).toBe(indexName);
  else expect(scan?.['Index Name']).toBeDefined();
  expect(m.plan['Actual Rows']).toBe(rows);
  expect(scan?.['Actual Rows']).toBe(rows);
  expect(m.buffers).toBeGreaterThan(0);
}

// القياسات المسجلة تحت إعدادات المخطط الطبيعية (من غير تعطيل المسح المتسلسل)، على القاعدة
// المزروعة بعد ANALYZE: المسح المرتب بيعدّي على كل صف مطابق للترتيب قبل أول مطابق للحالة،
// وده الكلفة المقصودة لفهرس غير واعٍ بالحالة؛ الصفوف المفلترة محسوبة بحدودها المنطقية مش بعدد ثابت.
it('L2 sparse open page: resolved history newer than the open rows is filtered in index order', async () => {
  const first = await measure('sparse-open', 'open', null);
  expectOrderedIndexScanUnderLimit(first, 21, 'commission_blocked_corrections_list_idx');
  expect(first.removed).toBeGreaterThanOrEqual(0);
  expect(first.removed).toBeLessThanOrEqual(12000);
  expect(first.buffers).toBeLessThanOrEqual(2000);
});

it('L2 sparse open page with a cursor inside the resolved history keeps the ordered index scan', async () => {
  const inside = await measure('sparse-open', 'open', await anchor('sparse-open', true, 6000));
  expectOrderedIndexScanUnderLimit(inside, 21, 'commission_blocked_corrections_list_idx');
  expect(inside.removed).toBeGreaterThanOrEqual(0);
  expect(inside.removed).toBeLessThanOrEqual(6000);
  // مؤشر بعد آخر صف محلول أحدث: الشرط على (created_at, id) بيبدأ المسح بعد التاريخ المحلول.
  const past = await measure('sparse-open', 'open', await anchor('sparse-open', false, 20));
  expectOrderedIndexScanUnderLimit(past, 21, 'commission_blocked_corrections_list_idx');
  expect(past.removed).toBeGreaterThanOrEqual(0);
  expect(past.removed).toBeLessThanOrEqual(12000);
  expect(past.buffers).toBeLessThanOrEqual(inside.buffers + 50);
});

it('L2 the all page keeps the index order with no status filter on a sparse activity', async () => {
  const all = await measure('sparse-open', 'all', null);
  expectOrderedIndexScanUnderLimit(all, 21, 'commission_blocked_corrections_list_idx');
  expect(all.removed).toBe(0);
  const next = await measure('sparse-open', 'all', await anchor('sparse-open', true, 100));
  expectOrderedIndexScanUnderLimit(next, 21, 'commission_blocked_corrections_list_idx');
  expect(next.removed).toBe(0);
});

it('L2 sparse resolved page: open rows newer than the resolved ones are filtered in index order', async () => {
  const first = await measure('sparse-resolved', 'resolved', null);
  expectOrderedIndexScanUnderLimit(first, 21);
  expect(first.removed).toBeGreaterThanOrEqual(0);
  expect(first.removed).toBeLessThanOrEqual(1000);
  const cursor = await measure(
    'sparse-resolved',
    'resolved',
    await anchor('sparse-resolved', true, 20),
  );
  expectOrderedIndexScanUnderLimit(cursor, 21);
  expect(cursor.removed).toBeGreaterThanOrEqual(0);
  expect(cursor.removed).toBeLessThanOrEqual(1000);
});

it('L2 empty open page reads the whole resolved history and returns no rows', async () => {
  const m = await measure('empty-open', 'open', null);
  expectOrderedIndexScanUnderLimit(m, 0);
  expect(m.removed).toBeGreaterThanOrEqual(0);
  expect(m.removed).toBeLessThanOrEqual(12000);
  expect(m.buffers).toBeLessThanOrEqual(2000);
});

it('L2 empty resolved page reads the whole open set and returns no rows', async () => {
  const m = await measure('empty-resolved', 'resolved', null);
  expectOrderedIndexScanUnderLimit(m, 0);
  expect(m.removed).toBeGreaterThanOrEqual(0);
  expect(m.removed).toBeLessThanOrEqual(1000);
});
