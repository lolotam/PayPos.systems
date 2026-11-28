/** تهيئة مشتركة لاختبارات خطة التنفيذ: نشاط وملف و500 صف معاينة ثم ANALYZE لدقة إحصاءات المُخطط. */
async function seedExplainWorkspace(h: Awaited<ReturnType<typeof startHarness>>) {
  const ids = systemUuidV7();
  const { company, business, userId } = await seedCatalogWorkspace(h, ids);
  const file = ids.newId();
  await h.owner`INSERT INTO file_objects
    (company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES (${company},${file},${business},'catalog',${business},'staging/x','verified/x',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,'read:files:business',${userId},now(),'READY')`;
  const keys = Array.from({ length: 500 }, () => ids.newId());
  const seeded = ids.newId();
  // معاينة فيها 25 صفاً مطبّعاً: صفحة المعاينة تقرأ 20 صفاً، فالعدد لازم يتجاوز
  // حد الصفحة عشان استعلام الصفحة يبان فيه صف تاني — والصفوف بتتخزّن JSON حقيقي
  // (h.owner.json) مش نص JSON، عشان jsonb_array_elements يتعامل معاها كمصفوفة.
  const previewRows = Array.from({ length: 25 }, (_value, index) => ({
    row: index + 1,
    name_en: `Imported service ${index + 1}`,
    name_ar: null,
    price: '12.500',
    duration_minutes: 30,
    category_id: null,
    category_name_en: null,
    commission_rule: { kind: 'FOLLOW_PLAN' },
    commission_value: null,
    commission_rule_defaulted: false,
    counts_toward_threshold: true,
  }));
  await h.owner`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status)
    VALUES (${company},${seeded},${business},'services',${file},${userId},now(),
      now() + interval '24 hours',${previewRows.length},0,${h.owner.json(previewRows)},'[]'::jsonb,'ready')`;
  await h.owner`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status)
    SELECT p.company_id,k.id,p.business_id,p.entity,p.file_id,p.created_by,p.created_at,p.expires_at,p.row_count,p.error_count,p.rows,p.errors,p.status
    FROM (SELECT company_id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status
      FROM import_previews WHERE id=${seeded} LIMIT 1) p CROSS JOIN unnest(${keys}::uuid[]) k(id)`;
  await h.owner`ANALYZE import_previews`;
  return { company, business, userId, seeded };
}

import { expect, it } from 'vitest';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import keyVectors from '../domain/__tests__/service-import-key-vectors.json' with { type: 'json' };
import { serviceCategoryKey, normalizeServiceCategoryName } from '../domain/service-category.ts';
import { serviceImportRowsStatement } from '../queries/service-import-rows.query.ts';

import { startHarness } from '../../../../test/harness.ts';
import { seedCatalogWorkspace } from './service-import.fixture.ts';

// استعلام الصفحات الإنتاجي نفسه (serviceImportRowsStatement تحت withTenant) يجب أن يمشي
// على المفتاح (company_id, id) — الخطة إلزامية على استعلام الإنتاج نفسه لا على نسخة منسوخة.
async function previewPagePlan(
  database: ReturnType<typeof createDatabase>,
  scope: { company: string; business: string; userId: string; seeded: string },
) {
  const { company, business, userId, seeded } = scope;
  const statement = serviceImportRowsStatement(
    { companyId: company, businessId: business, userId, previewId: seeded },
    1,
    20,
  );
  return database.withTenant(
    company,
    (tx) => tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`),
    { userId },
  );
}

// مفاتيح الأسماء من المطبّع المشترك، ومساواة lower() على Postgres الفعلي بمتجهات Unicode المفحوصة (A-11/A-12).

const sameKey = keyVectors.same_key as unknown as readonly [string, string][];
const differentKeys = keyVectors.different_keys as unknown as readonly [string, string][];

it('derives the same key for same-key vectors and different keys otherwise', () => {
  for (const [left, right] of sameKey) expect(serviceCategoryKey(left)).toBe(serviceCategoryKey(right));
  for (const [left, right] of differentKeys)
    expect(serviceCategoryKey(left)).not.toBe(serviceCategoryKey(right));
});

// جدول سلوك lower() الفعلي على Postgres لهذا الخادم لمتجهات A-9 المفحوصة، بالترتيب نفسه:
// same_key: كل الأزواج متطابقة إلا زوج İ التركية — lower() هنا لا يفرد İ (فروق ترتيب موثّقة A-11).
// different_keys: زوج المؤلف/المفكك يبقى متمايزاً، وزوج الحروف الأعلى/الصغيرة مع ICU يُطوى.
const PG_SAME_KEY_EXPECTED = [true, true, true, false, true, true, true, true] as const;
const PG_DIFFERENT_KEY_EXPECTED = [false, true] as const;

it('agrees with Postgres lower() on the checked-in vectors, documenting collation divergences', async () => {
  const h = await startHarness();
  try {
    const sameKeyObserved: boolean[] = [];
    for (const [left, right] of sameKey) {
      const [row] = await h.owner`SELECT lower(${normalizeServiceCategoryName(left)}) = lower(${normalizeServiceCategoryName(right)}) AS same`;
      sameKeyObserved.push(row?.['same'] === true);
    }
    expect(sameKeyObserved).toEqual([...PG_SAME_KEY_EXPECTED]);
    const differentKeyObserved: boolean[] = [];
    for (const [left, right] of differentKeys) {
      const [row] = await h.owner`SELECT lower(${normalizeServiceCategoryName(left)}) = lower(${normalizeServiceCategoryName(right)}) AS same`;
      differentKeyObserved.push(row?.['same'] === true);
    }
    expect(differentKeyObserved).toEqual([...PG_DIFFERENT_KEY_EXPECTED]);
  } finally {
    await h.close();
  }
});

it('scans the scoped unique index for category matching and the business index for names', async () => {
  const h = await startHarness();
  try {
    const { company, business, userId, seeded } = await seedExplainWorkspace(h);
    const [categoryPlan] = await h.owner`EXPLAIN (FORMAT JSON) SELECT c.id
      FROM unnest(ARRAY['hair']) WITH ORDINALITY AS t(label, ord)
      JOIN service_categories c
        ON c.company_id = ${company}
       AND c.business_id = ${business}
       AND lower(c.name_en) = t.label
       AND c.closed_at IS NULL`;
    const categoryText = JSON.stringify(categoryPlan?.[0] ?? categoryPlan);
    expect(categoryText).toContain('service_categories_business_name_uq');
    // القراءة الحاسمة الحالية: الطرفان يُطويان بتعبير PostgreSQL واحد كما تشغّله المعاينة والعامل.
    const [namePlan] = await h.owner`EXPLAIN (FORMAT JSON) SELECT DISTINCT i.lookup_key
      FROM (
        SELECT label, lower(btrim(regexp_replace(label, '[[:space:]]+', ' ', 'g'))) AS lookup_key
        FROM unnest(ARRAY['hair cut']::text[]) AS t(label)
      ) i
      JOIN services s
        ON s.company_id = ${company}
       AND s.business_id = ${business}
       AND lower(btrim(regexp_replace(s.name_en, '[[:space:]]+', ' ', 'g'))) = i.lookup_key`;
    const nameText = JSON.stringify(namePlan?.[0] ?? namePlan);
    expect(nameText).toContain('services_company_business_id_key');
    const db = createDatabase({ url: h.urls.app, ids: systemUuidV7() });
    let rowsPlan: unknown;
    try {
      rowsPlan = await previewPagePlan(db, { company, business, userId, seeded });
    } finally {
      await db.close();
    }
    const rowsText = JSON.stringify(
      (rowsPlan as unknown as { 'QUERY PLAN': unknown }[])?.[0] ?? rowsPlan,
    );
    expect(rowsText).toContain('import_previews_pkey');
    const previewPlan = await h.owner`EXPLAIN ANALYZE SELECT id AS preview_id,status,created_count,error_code
      FROM import_previews
      WHERE company_id=${company}
        AND business_id=${business}
        AND created_by=${userId}
        AND id=${seeded} AND entity='services'`;
    const previewText = (previewPlan as unknown as { 'QUERY PLAN': string }[])
      .map((row) => row['QUERY PLAN'])
      .join('\n');
    expect(previewText).toMatch(/import_previews_pkey/);
  } finally {
    await h.close();
  }
});
