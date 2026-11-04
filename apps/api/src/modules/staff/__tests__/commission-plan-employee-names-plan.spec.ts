import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  commissionPlanEmployeeNamesStatement,
  readCommissionPlanEmployeeNames,
} from '../persistence/commission-plan-employee-names.ts';
import {
  ids,
  sessionFixture,
  type SessionFixture,
} from '../../../../test/service-session.fixture.ts';
import { takeTestEmployeeNumbers } from '../../../../test/test-employee-number.ts';
import { planNodes, rowsRead, type PlanNode } from './employee-name-search-plan.check.ts';

// خطة قائمة موظفي الخطط على فهرسها الجزئي (name_en_key, id) (PP-122). نشاط الهدف فيه 2000
// موظف، منهم 300 باسم واحد، والفلو في نشاطين تانيين. الحالة دي اللي بتختبر الـ keyset بالقيمة:
// مرساة في نص مجموعة الاسم الواحد وقرب آخرها. سبب عدم إطفاء enable_seqscan: المطلوب إثبات
// اختيار المخطط الافتراضي نفسه.
const FILLER = 2000;
const GROUP = 300;
const LIMIT = 20;
const LIST_INDEX = 'employees_company_business_name_en_key_id_active_idx';
const NAME_AR = 'موظفة اصطناعية';
const NAME_EN = 'Aaa plan employee';
const NAME_EN_KEY = 'aaa plan employee';

let f: SessionFixture;
let businessRows = 0;
let group: string[] = [];

// distinct بيدّي كل موظف اسم مختلف بييجي بعد مجموعة الاسم الواحد في الترتيب.
async function seedEmployees(
  companyId: string,
  businessId: string,
  branchId: string,
  count: number,
  distinct: boolean,
): Promise<string[]> {
  const employeeIds = Array.from({ length: count }, () => ids.newId());
  const firstNumber = takeTestEmployeeNumbers(companyId, count);
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_ar,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${companyId},t.id,${businessId},${branchId},${NAME_AR},
      ${NAME_EN}::text || CASE WHEN ${distinct}::boolean THEN ' ' || lpad(t.n::text, 4, '0') ELSE '' END,
      ${NAME_EN_KEY}::text || CASE WHEN ${distinct}::boolean THEN ' ' || lpad(t.n::text, 4, '0') ELSE '' END,
      'staff','2026-01-01', t.n + ${firstNumber - 1}
    FROM unnest(${employeeIds}::uuid[]) WITH ORDINALITY AS t(id, n)`;
  return employeeIds;
}

beforeAll(async () => {
  f = await sessionFixture();
  group = (await seedEmployees(f.company, f.business, f.branch, GROUP, false)).sort();
  await seedEmployees(f.company, f.business, f.branch, FILLER - GROUP, true);
  await seedEmployees(f.otherCompany, f.foreignBusiness, f.foreignBranch, FILLER, false);
  await seedEmployees(f.company, f.secondBusiness, f.secondBranch, FILLER, false);
  await f.h.owner`ANALYZE employees`;
  const counted = await f.h.owner`SELECT count(*)::int AS total FROM employees
    WHERE company_id=${f.company} AND business_id=${f.business}`;
  businessRows = Number(counted[0]?.['total'] ?? 0);
});

afterAll(async () => {
  await f?.close();
});

type EmployeeRow = Record<string, unknown> & { readonly id: string; readonly name_en_key: string };
type After = { readonly key: string; readonly id: string } | null;

async function rows(after: After, limit: number): Promise<EmployeeRow[]> {
  const fetched = await f.db.withTenant(f.company, (tx) =>
    tx.execute<EmployeeRow>(
      commissionPlanEmployeeNamesStatement(f.company, f.business, after, limit),
    ),
  );
  // الجملة بتجيب صف زائد عشان تكشف وجود صفحة جاية؛ هنا بنقصّ زي طبقة الاستعلام.
  return fetched.slice(0, limit);
}

// عقد الجدول بس: عقد الفهرس تحت الـ heap مش منها.
function employeesScans(nodes: PlanNode[]): PlanNode[] {
  return nodes.filter(
    (node) => node['Relation Name'] === 'employees' && node['Node Type'] !== 'Bitmap Index Scan',
  );
}

// شرط الفهرس بييجي من العقدة نفسها أو من فروعها (شجرة الـ bitmap).
function indexCondition(node: PlanNode): string {
  const own = node['Index Cond'];
  const children = (node.Plans ?? []).map(indexCondition).join(' ');
  return `${typeof own === 'string' ? own : ''} ${children}`;
}

async function planOf(after: After): Promise<PlanNode[]> {
  const statement = commissionPlanEmployeeNamesStatement(f.company, f.business, after, LIMIT);
  const plan = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`),
  );
  return planNodes(plan);
}

// مفيش عقدة مرساة: كل قراءة لجدول الموظفين مربوطة بالشركة والنشاط في شرط الفهرس، والموضع بعد
// المرساة جزء من شرط الفهرس نفسه، فالصفحة بتقرأ LIMIT + 1 صف بس من غير ترتيب، مهما كان مكانها في
// مجموعة الاسم الواحد. الأرقام بتتسجّل في سجل الـ CI دليلاً على التكلفة.
function expectTenantBounded(nodes: PlanNode[], label: string, after: After): void {
  const scans = employeesScans(nodes);
  expect(scans.length, `${label}: no employees node in the plan`).toBeGreaterThan(0);
  for (const scan of scans) {
    expect(scan['Node Type'], `${label}: employees is read by a sequential scan`).not.toBe(
      'Seq Scan',
    );
    expect(indexCondition(scan), `${label}: not bound by the company`).toContain('company_id');
    expect(indexCondition(scan), `${label}: not bound by the business`).toContain('business_id');
    expect(scan['Index Name'], `${label}: not read through the list index`).toBe(LIST_INDEX);
    if (after !== null) {
      expect(indexCondition(scan), `${label}: the anchor is filtered`).toContain(after.id);
    }
  }
  const read = scans.reduce((total, scan) => total + rowsRead(scan), 0);
  const metrics = scans.map((scan) => ({
    node: scan['Node Type'],
    rows: scan['Actual Rows'],
    loops: scan['Actual Loops'],
    removedByFilter: scan['Rows Removed by Filter'] ?? 0,
    indexCond: indexCondition(scan),
  }));
  const sorts = nodes.map((node) => node['Node Type']).filter((type) => /Sort/.test(type ?? ''));
  console.info('commission_plan_employee_plan', { label, businessRows, read, metrics, sorts });
  expect(sorts, `${label}: the plan sorts the rows`).toEqual([]);
  expect(read, `${label}: the page read more rows than it returns`).toBeLessThanOrEqual(LIMIT + 1);
}

it('the statement returns the four list columns and the raw sort key only', async () => {
  const first = await rows(null, LIMIT);
  expect(first.map((row) => row.id)).toEqual(group.slice(0, LIMIT));
  expect(Object.keys(first[0] ?? {}).sort()).toEqual([
    'employee_number',
    'id',
    'name_ar',
    'name_en',
    'name_en_key',
  ]);
  expect(first.every((row) => row.name_en_key === NAME_EN_KEY)).toBe(true);
  const numbers = first.map((row) => Number(row['employee_number']));
  expect(numbers.every((number) => number >= 1 && number <= 999_999)).toBe(true);
});

it('the first page and pages inside and at the end of a same-name group read one page only', async () => {
  expect(businessRows).toBeGreaterThanOrEqual(FILLER);
  expectTenantBounded(await planOf(null), 'first page', null);
  const middle = { key: NAME_EN_KEY, id: group[GROUP / 2 - 1] as string };
  expectTenantBounded(await planOf(middle), 'middle of the group', middle);
  const nearEnd = { key: NAME_EN_KEY, id: group[GROUP - 5] as string };
  expectTenantBounded(await planOf(nearEnd), 'near the end of the group', nearEnd);
});

it('a page continues by value after the anchor, inside the group and across its end', async () => {
  const middle = await rows({ key: NAME_EN_KEY, id: group[GROUP / 2 - 1] as string }, LIMIT);
  expect(middle.map((row) => row.id)).toEqual(group.slice(GROUP / 2, GROUP / 2 + LIMIT));
  const nearEnd = await rows({ key: NAME_EN_KEY, id: group[GROUP - 5] as string }, LIMIT);
  expect(nearEnd.map((row) => row.id).slice(0, 4)).toEqual(group.slice(GROUP - 4));
  expect(nearEnd).toHaveLength(LIMIT);
  expect(nearEnd.slice(4).every((row) => row.name_en_key > NAME_EN_KEY)).toBe(true);
});

// سلبي الـ RLS: شروط company_id/business_id في الجملة لوحدها مش دليل؛ هنا الشركة التانية
// مطلوبة صراحةً بمعرّفاتها، فالصفر جاي من سياسة الجدول نفسها مش من الـ WHERE.
it('RLS another tenant reads none of a company employees, and the owner tenant reads them', async () => {
  const crossed = await f.db.withTenant(f.company, (tx) =>
    readCommissionPlanEmployeeNames(tx, f.otherCompany, f.foreignBusiness, null, LIMIT),
  );
  expect(crossed).toEqual([]);
  const own = await f.db.withTenant(f.otherCompany, (tx) =>
    readCommissionPlanEmployeeNames(tx, f.otherCompany, f.foreignBusiness, null, LIMIT),
  );
  expect(own).toHaveLength(LIMIT + 1);
});
