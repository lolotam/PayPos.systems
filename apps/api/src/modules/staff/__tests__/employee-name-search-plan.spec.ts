import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { employeeListSearch } from '../persistence/employee-list-search.ts';
import { listEmployeesStatement } from '../queries/list-employees.query.ts';
import { sessionPerformerOptionsStatement } from '../queries/session-performer-options.query.ts';
import {
  ids,
  sessionFixture,
  type SessionFixture,
} from '../../../../test/service-session.fixture.ts';
import { takeTestEmployeeNumbers } from '../../../../test/test-employee-number.ts';

// اختبارات خطة البحث بالاسم: قائمة الموظفين ومنتقي موظف الاستقبال (ADR-0048).
// السبب: تحت FORCE RLS لا يتحوّل LIKE إلى شرط فهرس لأن textlike ليس LEAKPROOF، فالفهرس
// التريغرام لا يُستخدم أبداً؛ ما يحدّ المسح هو فهرس المستأجر (company_id, business_id, id).
// الاختبار يثبت أربعة أشياء: أن المسح مربوط بالشركة والنشاط لا مسح تسلسلي للجدول، وأن
// البحث بالاسم يبقى فلتراً في العقدة لا شرط فهرس، وأن عدد الصفوف المقروءة لا يتجاوز
// عدد موظفي النشاط — وهو ما يسقط أي تغيير يفلت فلتر المستأجر من الفهرس.
// سبب عدم إطفاء enable_seqscan: المطلوب إثبات اختيار المخطط الافتراضي نفسه؛ إطفاء
// المسح التسلسلي يثبت فقط أن الفهرس قابل للوصول، ويخفي مخططاً خاطئاً قد يختاره المخطط.
const FILLER = 2000;
const NAME_AR = 'سارة اصطناعية';
const NAME_EN = 'Synthetic Sara';
const NAME_EN_KEY = 'synthetic sara';
const TERM_AR = 'سارة';
const TERM_EN = 'Sara';
const OCCURRED_AT = '2026-10-14T01:30:00Z';
const DAY = '2026-10-13';

let f: SessionFixture;
let businessRows = 0;
const businessIds = new Set<string>();
const targetIds: string[] = [];
const fillerIds: string[] = [];

interface PlanNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Filter?: string;
  'Index Cond'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

// عقدة واحدة لكل علاقة في الشجرة، مع كل حقولها؛ العدّاد يحتاج الصفوف المقروءة لا النوع فقط.
function planNodes(plan: unknown): PlanNode[] {
  const nodes: PlanNode[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const parsed = safeJson(value);
      if (parsed !== null) visit(parsed);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record['Node Type'] === 'string') {
      nodes.push(record as PlanNode);
      visit(record['Plans']);
      return;
    }
    visit(record['Plan']);
    visit(record['QUERY PLAN']);
  };
  visit(plan);
  return nodes;
}

// العقدة التي تقرأ جدول الموظفين هي وحدها التي يصحّ أن تقيس حدود المسح.
function employeesNodes(nodes: PlanNode[]): PlanNode[] {
  return nodes.filter((node) => node['Relation Name'] === 'employees');
}

function rowsRead(node: PlanNode): number {
  return (
    ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) *
    (node['Actual Loops'] ?? 1)
  );
}

// أي واحدة من دي لو اتكسرت يبقى البحث بقى بيقرا جدول الموظفين برّه حدود النشاط (ADR-0048).
function assertTenantBounded(nodes: PlanNode[], label: string, allowedRows: number) {
  const employees = employeesNodes(nodes);
  expect(employees.length, `${label}: no employees node in the plan`).toBeGreaterThan(0);
  expect(
    employees.some((node) => node['Node Type'] === 'Seq Scan'),
    `${label}: employees is read by a sequential scan`,
  ).toBe(false);
  const indexNames = employees
    .map((node) => node['Index Name'])
    .filter((name): name is string => typeof name === 'string');
  expect(
    indexNames.some((name) => /employees_company_business_id_(idx|key)/.test(name)),
    `${label}: employees is not read through the tenant index (${indexNames.join(', ')})`,
  ).toBe(true);
  // الدليل الذي لا يتأثر بشكل المخطط: الوصول لجدول الموظفين مربوط بالشركة والنشاط معاً.
  const bound = employees
    .map((node) => `${node['Index Cond'] ?? ''} ${node['Filter'] ?? ''}`)
    .join(' ');
  expect(
    bound,
    `${label}: the employees access is not bound by company_id and business_id`,
  ).toMatch(/company_id/);
  expect(
    bound,
    `${label}: the employees access is not bound by company_id and business_id`,
  ).toMatch(/business_id/);
  for (const node of employees) {
    expect(
      node['Index Cond'] ?? '',
      `${label}: the name predicate became an index condition`,
    ).not.toMatch(/name_ar|name_en/);
  }
  expect(
    employees.some((node) => (node['Filter'] ?? '').includes('name_ar')),
    `${label}: the name predicate is not a filter`,
  ).toBe(true);
  for (const node of employees) {
    expect(
      rowsRead(node),
      `${label}: the node read more rows than the business holds`,
    ).toBeLessThanOrEqual(allowedRows);
  }
}

async function seedFiller(
  companyId: string,
  businessId: string,
  branchId: string,
  count: number,
): Promise<string[]> {
  const employeeIds = Array.from({ length: count }, () => ids.newId());
  const firstNumber = takeTestEmployeeNumbers(companyId, count);
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_ar,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${companyId},id,${businessId},${branchId},${NAME_AR},${NAME_EN},${NAME_EN_KEY},'staff','2026-01-01',
      row_number() OVER () + ${firstNumber - 1}
    FROM unnest(${employeeIds}::uuid[]) AS id`;
  return employeeIds;
}

// موظفو النشاط الهدف: بدونهم يبقى البحث بلا نتيجة، والفلو في نشاطين آخرين باسم مطابق.
async function seedTargets(): Promise<void> {
  const employeeIds = Array.from({ length: 3 }, () => ids.newId());
  const linkIds = Array.from({ length: 3 }, () => ids.newId());
  const firstNumber = takeTestEmployeeNumbers(f.company, employeeIds.length);
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_ar,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${f.company},id,${f.business},${f.branch},${NAME_AR},${NAME_EN},${NAME_EN_KEY},'staff','2026-01-01',
      row_number() OVER () + ${firstNumber - 1}
    FROM unnest(${employeeIds}::uuid[]) AS id`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    SELECT ${f.company},id,${f.business},employee_id,${f.branch},'2026-01-01'
    FROM unnest(${linkIds}::uuid[],${employeeIds}::uuid[]) AS t(id,employee_id)`;
  targetIds.push(...employeeIds);
}

beforeAll(async () => {
  f = await sessionFixture();
  await seedTargets();
  fillerIds.push(...(await seedFiller(f.otherCompany, f.foreignBusiness, f.foreignBranch, FILLER)));
  fillerIds.push(...(await seedFiller(f.company, f.secondBusiness, f.secondBranch, FILLER)));
  await f.h.owner`ANALYZE employees`;
  await f.h.owner`ANALYZE employee_branches`;
  const counted = await f.h
    .owner`SELECT count(*)::int AS total FROM employees WHERE company_id=${f.company} AND business_id=${f.business}`;
  businessRows = Number(counted[0]?.['total'] ?? 0);
  const owned = await f.h
    .owner`SELECT id FROM employees WHERE company_id=${f.company} AND business_id=${f.business}`;
  for (const row of owned) businessIds.add(String(row['id']));
});

afterAll(async () => {
  await f?.close();
});

async function listIds(q: string): Promise<string[]> {
  const rows = await f.db.withTenant(f.company, (tx) =>
    tx.execute<{ id: string }>(
      listEmployeesStatement(
        f.company,
        f.business,
        { limit: 20, q },
        [f.branch],
        employeeListSearch(q),
      ),
    ),
  );
  return rows.map((row) => row.id);
}

async function performerIds(q: string, lang: 'ar' | 'en'): Promise<string[]> {
  const rows = await f.db.withTenant(f.company, (tx) =>
    tx.execute<{ id: string }>(
      sessionPerformerOptionsStatement(
        f.company,
        f.business,
        f.branch,
        DAY,
        { occurred_at: OCCURRED_AT, lang, q, limit: 20 },
        null,
        null,
      ),
    ),
  );
  return rows.map((row) => row.id);
}

// شريحة النشاط أصغر بمراتب من الفلو؛ بدونها لا يبقى عدد الصفوف المقروءة مقياساً.
function expectSmallBusinessSlice() {
  expect(businessRows).toBeGreaterThan(targetIds.length);
  expect(businessRows).toBeLessThan((FILLER * 2) / 10);
}

it('the tenant index bounds the staff list name search in Arabic and English', async () => {
  expectSmallBusinessSlice();
  for (const q of [TERM_AR, TERM_EN]) {
    const plan = await f.db.withTenant(f.company, (tx) =>
      tx.execute(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${listEmployeesStatement(f.company, f.business, { limit: 20, q }, [f.branch], employeeListSearch(q))}`,
      ),
    );
    assertTenantBounded(planNodes(plan), `list q=${q}`, businessRows);
  }
});

it('the tenant index bounds the performer picker name search in Arabic and English', async () => {
  expectSmallBusinessSlice();
  for (const lang of ['ar', 'en'] as const) {
    for (const q of [TERM_AR, TERM_EN]) {
      const plan = await f.db.withTenant(f.company, (tx) =>
        tx.execute(
          sql`EXPLAIN (ANALYZE, FORMAT JSON) ${sessionPerformerOptionsStatement(
            f.company,
            f.business,
            f.branch,
            DAY,
            { occurred_at: OCCURRED_AT, lang, q, limit: 20 },
            null,
            null,
          )}`,
        ),
      );
      assertTenantBounded(planNodes(plan), `performer lang=${lang} q=${q}`, businessRows);
    }
  }
});

it('the name search returns the searched business only and hides every filler row', async () => {
  for (const q of [TERM_AR, TERM_EN]) {
    const listed = await listIds(q);
    expect(listed.slice().sort(), `list q=${q}`).toEqual(targetIds.slice().sort());
    expect(listed.every((id) => businessIds.has(id))).toBe(true);
    expect(listed.some((id) => fillerIds.includes(id))).toBe(false);
    for (const lang of ['ar', 'en'] as const) {
      const performed = await performerIds(q, lang);
      expect(performed.slice().sort(), `performer lang=${lang} q=${q}`).toEqual(
        targetIds.slice().sort(),
      );
      expect(performed.every((id) => businessIds.has(id))).toBe(true);
      expect(performed.some((id) => fillerIds.includes(id))).toBe(false);
    }
  }
});
