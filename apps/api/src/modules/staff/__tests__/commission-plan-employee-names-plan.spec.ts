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
import { planNodes, type PlanNode } from './employee-name-search-plan.check.ts';

// خطة قائمة موظفي الخطط: نفس فهرس الموظفين اللي بتستخدمه قوائم الموظفين، والفلو في نشاطين
// تانيين بيخلي نشاط الهدف انتقائياً، فالمفروض المخطط يقرأ من الفهرس مربوطاً بمفتاح
// المستأجر مش مسح تسلسلي للجدول. سبب عدم إطفاء enable_seqscan: المطلوب إثبات اختيار
// المخطط الافتراضي نفسه.
const FILLER = 2000;
const LIMIT = 20;
const NAME_AR = 'موظفة اصطناعية';
const NAME_EN = 'Aaa plan employee';
const NAME_EN_KEY = 'aaa plan employee';

let f: SessionFixture;
let businessRows = 0;
let targetIds: string[] = [];

async function seedFiller(
  companyId: string,
  businessId: string,
  branchId: string,
  count: number,
): Promise<void> {
  const employeeIds = Array.from({ length: count }, () => ids.newId());
  const firstNumber = takeTestEmployeeNumbers(companyId, count);
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_ar,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${companyId},id,${businessId},${branchId},${NAME_AR},${NAME_EN},${NAME_EN_KEY},'staff','2026-01-01',
      row_number() OVER () + ${firstNumber - 1}
    FROM unnest(${employeeIds}::uuid[]) AS id`;
}

// موظفو النشاط الهدف: كلهم باسم واحد، فحافة الصفحة المفتاحية بتقع على الاسم والمعرّف معاً.
async function seedTargets(): Promise<void> {
  const employeeIds = Array.from({ length: 6 }, () => ids.newId());
  const firstNumber = takeTestEmployeeNumbers(f.company, employeeIds.length);
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_ar,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${f.company},id,${f.business},${f.branch},${NAME_AR},${NAME_EN},${NAME_EN_KEY},'staff','2026-01-01',
      row_number() OVER () + ${firstNumber - 1}
    FROM unnest(${employeeIds}::uuid[]) AS id`;
  targetIds = employeeIds;
}

beforeAll(async () => {
  f = await sessionFixture();
  await seedTargets();
  await seedFiller(f.otherCompany, f.foreignBusiness, f.foreignBranch, FILLER);
  await seedFiller(f.company, f.secondBusiness, f.secondBranch, FILLER);
  await f.h.owner`ANALYZE employees`;
  const counted = await f.h.owner`SELECT count(*)::int AS total FROM employees
    WHERE company_id=${f.company} AND business_id=${f.business}`;
  businessRows = Number(counted[0]?.['total'] ?? 0);
});

afterAll(async () => {
  await f?.close();
});

type EmployeeRow = {
  readonly id: string;
  readonly name_ar: string | null;
  readonly name_en: string;
  readonly employee_number: number;
};

async function rows(afterId: string | null, limit: number): Promise<EmployeeRow[]> {
  const fetched = await f.db.withTenant(f.company, (tx) =>
    tx.execute<EmployeeRow>(
      commissionPlanEmployeeNamesStatement(f.company, f.business, afterId, limit),
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

function rowsRead(node: PlanNode): number {
  const read =
    (node['Actual Rows'] ?? 0) +
    (node['Rows Removed by Filter'] ?? 0) +
    (node['Rows Removed by Index Recheck'] ?? 0);
  return read * (node['Actual Loops'] ?? 1);
}

async function planOf(afterId: string | null, limit: number): Promise<PlanNode[]> {
  const plan = await f.db.withTenant(f.company, (tx) =>
    tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${commissionPlanEmployeeNamesStatement(f.company, f.business, afterId, limit)}`,
    ),
  );
  return planNodes(plan);
}

function expectTenantBounded(nodes: PlanNode[], label: string): void {
  const scans = employeesScans(nodes);
  expect(scans.length, `${label}: no employees node in the plan`).toBeGreaterThan(0);
  for (const scan of scans) {
    expect(scan['Node Type'], `${label}: employees is read by a sequential scan`).not.toBe(
      'Seq Scan',
    );
    expect(indexCondition(scan), `${label}: the access is not bound by the company`).toContain(
      'company_id',
    );
  }
  // عقدة الصفحة نفسها مربوطة بالنشاط كمان؛ عقدة المرساة مربوطة بالمعرّف بس.
  expect(
    scans.some((scan) => indexCondition(scan).includes('business_id')),
    `${label}: the access is not bound by the business`,
  ).toBe(true);
  const read = scans.reduce((total, scan) => total + rowsRead(scan), 0);
  expect(read, `${label}: the plan read more rows than the business holds`).toBeLessThanOrEqual(
    businessRows + LIMIT + 1,
  );
}

it('the statement returns only the four columns of the plan list', async () => {
  const first = await rows(null, LIMIT);
  expect(first.length).toBeGreaterThan(0);
  expect(Object.keys(first[0] ?? {}).sort()).toEqual([
    'employee_number',
    'id',
    'name_ar',
    'name_en',
  ]);
  expect(first.every((row) => row.employee_number >= 1 && row.employee_number <= 999_999)).toBe(
    true,
  );
});

it('the first page and the next page are both read through the tenant index', async () => {
  expect(businessRows).toBeGreaterThan(targetIds.length);
  expect(businessRows).toBeLessThan((FILLER * 2) / 10);
  expectTenantBounded(await planOf(null, LIMIT), 'first page');
  const first = await rows(null, 2);
  const anchor = first[first.length - 1]?.id as string;
  expectTenantBounded(await planOf(anchor, LIMIT), 'next page');
});

it('the next page continues after the anchor in the stored order', async () => {
  const ordered = [...targetIds].sort();
  const first = await rows(null, 2);
  expect(first.map((row) => row.id)).toEqual(ordered.slice(0, 2));
  const anchor = first[first.length - 1]?.id as string;
  const second = await rows(anchor, 2);
  expect(second.map((row) => row.id)).toEqual(ordered.slice(2, 4));
  const third = await rows(second[second.length - 1]?.id as string, 2);
  expect(third.map((row) => row.id)).toEqual(ordered.slice(4, 6));
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
