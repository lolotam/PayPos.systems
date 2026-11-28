import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { sessionServiceOptionsStatement } from '../queries/session-service-options.query.ts';
import {
  ids,
  sessionFixture,
  type SessionFixture,
} from '../../../../test/service-session.fixture.ts';
import { planNodes, tenantBoundProblems, type PlanNode } from './service-name-search-plan.check.ts';

// اختبارات خطة البحث بالاسم في منتقي الخدمات: نفس سبب اختبار الموظفين (ADR-0048).
// تحت FORCE RLS ما بيتحوّلش LIKE إلى شرط فهرس لأن textlike مش LEAKPROOF، فالفهرس
// التريغرام ما يُستخدمش أبداً؛ ما يحدّ المسح هو المفتاح الفريد على
// (company_id, business_id, id). الاختبار يثبت أربعة أشياء: أن المسح مربوط
// بالشركة والنشاط لا مسح تسلسلي للجدول، وأن البحث بالاسم يبقى فلتراً في العقدة
// لا شرط فهرس، وأن عدد الصفوف المقروءة لا يتجاوز خدمات النشاط، وأن النتيجة
// خدمات النشاط الهدف بس.
// سبب عدم إطفاء enable_seqscan: المطلوب إثبات اختيار المخطط الافتراضي نفسه؛
// إطفاء المسح التسلسلي يثبت فقط أن الفهرس قابل للوصول، ويخفي مخططاً خاطئاً قد
// يختاره المخطط.
const FILLER = 2000;
const NAME_AR = 'خدمة اصطناعية';
const NAME_EN = 'Synthetic haircut';
const TERM_AR = 'اصطناعية';
const TERM_EN = 'haircut';

let f: SessionFixture;
let businessRows = 0;
const businessIds = new Set<string>();
const targetIds: string[] = [];
const fillerIds: string[] = [];

// الفحص كله في ملف الفاحص؛ هنا غلاف رقيق بيقول إن قائمة المشاكل فاضية، يعني المخطط
// مربوط بمفتاح المستأجر ومش بيقرا برّه حدود النشاط.
function assertTenantBounded(nodes: PlanNode[], label: string, allowedRows: number) {
  expect(
    tenantBoundProblems(nodes, allowedRows),
    `${label}: the plan is not bounded by the tenant key`,
  ).toEqual([]);
}

async function seedFiller(companyId: string, businessId: string, count: number): Promise<string[]> {
  const serviceIds = Array.from({ length: count }, () => ids.newId());
  await f.h
    .owner`INSERT INTO services(company_id,id,business_id,name_en,name_ar,price,commission_rule_kind)
    SELECT ${companyId},id,${businessId},${NAME_EN},${NAME_AR},'1.000','ZERO'
    FROM unnest(${serviceIds}::uuid[]) AS id`;
  return serviceIds;
}

// خدمات النشاط الهدف: بدونهم يبقى البحث بلا نتيجة، والفلو في نشاطين تانيين
// بنفس الاسم بيبيّن لو الفلتر اتسرّب من النشاط للشركة.
async function seedTargets(): Promise<void> {
  const serviceIds = Array.from({ length: 3 }, () => ids.newId());
  await f.h
    .owner`INSERT INTO services(company_id,id,business_id,name_en,name_ar,price,commission_rule_kind)
    SELECT ${f.company},id,${f.business},${NAME_EN},${NAME_AR},'1.000','ZERO'
    FROM unnest(${serviceIds}::uuid[]) AS id`;
  targetIds.push(...serviceIds);
}

beforeAll(async () => {
  f = await sessionFixture();
  await seedTargets();
  fillerIds.push(...(await seedFiller(f.otherCompany, f.foreignBusiness, FILLER)));
  fillerIds.push(...(await seedFiller(f.company, f.secondBusiness, FILLER)));
  await f.h.owner`ANALYZE services`;
  const counted = await f.h
    .owner`SELECT count(*)::int AS total FROM services WHERE company_id=${f.company} AND business_id=${f.business}`;
  businessRows = Number(counted[0]?.['total'] ?? 0);
  const owned = await f.h
    .owner`SELECT id FROM services WHERE company_id=${f.company} AND business_id=${f.business}`;
  for (const row of owned) businessIds.add(String(row['id']));
});

afterAll(async () => {
  await f?.close();
});

async function optionIds(lang: 'ar' | 'en', q: string): Promise<string[]> {
  const rows = await f.db.withTenant(f.company, (tx) =>
    tx.execute<{ id: string }>(
      sessionServiceOptionsStatement(f.company, f.business, { lang, q, limit: 20 }, null),
    ),
  );
  return rows.map((row) => row.id);
}

// شريحة النشاط أصغر بمراتب من الفلو؛ بدونها لا يبقى عدد الصفوف المقروءة مقياساً.
function expectSmallBusinessSlice() {
  expect(businessRows).toBeGreaterThan(targetIds.length);
  expect(businessRows).toBeLessThan((FILLER * 2) / 10);
}

it('the tenant index bounds the service picker name search in Arabic and English', async () => {
  expectSmallBusinessSlice();
  for (const lang of ['ar', 'en'] as const) {
    for (const q of [TERM_AR, TERM_EN]) {
      const plan = await f.db.withTenant(f.company, (tx) =>
        tx.execute(
          sql`EXPLAIN (ANALYZE, FORMAT JSON) ${sessionServiceOptionsStatement(f.company, f.business, { lang, q, limit: 20 }, null)}`,
        ),
      );
      assertTenantBounded(planNodes(plan), `service options lang=${lang} q=${q}`, businessRows);
    }
  }
});

it('the name search returns the searched business only and hides every filler row', async () => {
  for (const lang of ['ar', 'en'] as const) {
    for (const q of [TERM_AR, TERM_EN]) {
      const found = await optionIds(lang, q);
      expect(found.slice().sort(), `service options lang=${lang} q=${q}`).toEqual(
        targetIds.slice().sort(),
      );
      expect(found.every((id) => businessIds.has(id))).toBe(true);
      expect(found.some((id) => fillerIds.includes(id))).toBe(false);
    }
  }
});
