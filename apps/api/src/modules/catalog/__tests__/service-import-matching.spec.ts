import { expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import keyVectors from '../domain/__tests__/service-import-key-vectors.json' with { type: 'json' };
import { serviceCategoryKey, normalizeServiceCategoryName } from '../domain/service-category.ts';

import { startHarness } from '../../../../test/harness.ts';
import { seedCatalogWorkspace } from './service-import.fixture.ts';

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
    // صفوف قليلة تُحيي إحصاءات الجدول حتى يختار المُخطط مفتاح company_id+id الفريد بوضوح.
    const ids = systemUuidV7();
    const { company, business, userId } = await seedCatalogWorkspace(h, ids);
    const file = ids.newId();
    await h.owner`INSERT INTO file_objects
      (company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
      VALUES (${company},${file},${business},'catalog',${business},'staging/x','verified/x',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,'read:files:business',${userId},now(),'READY')`;
    // 500 صفاً مع ANALYZE تجعل إحصاءات الجدول حقيقية، فيختار المُخطط مفتاح company_id+id الفريد (نفس مهيأ الموظفين).
    const keys = Array.from({ length: 500 }, () => ids.newId());
    const seeded = ids.newId();
    await h.owner`INSERT INTO import_previews
      (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status)
      VALUES (${company},${seeded},${business},'services',${file},${userId},now(),
        now() + interval '24 hours',1,0,'[]'::jsonb,'[]'::jsonb,'ready')`;
    await h.owner`INSERT INTO import_previews
      (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status)
      SELECT p.company_id,k.id,p.business_id,p.entity,p.file_id,p.created_by,p.created_at,p.expires_at,p.row_count,p.error_count,p.rows,p.errors,p.status
      FROM (SELECT company_id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,status
        FROM import_previews WHERE id=${seeded} LIMIT 1) p CROSS JOIN unnest(${keys}::uuid[]) k(id)`;
    await h.owner`ANALYZE import_previews`;
    const [categoryPlan] = await h.owner`EXPLAIN (FORMAT JSON) SELECT c.id
      FROM unnest(ARRAY['hair']) WITH ORDINALITY AS t(label, ord)
      JOIN service_categories c
        ON c.company_id = ${company}
       AND c.business_id = ${business}
       AND lower(c.name_en) = t.label
       AND c.closed_at IS NULL`;
    const categoryText = JSON.stringify(categoryPlan?.[0] ?? categoryPlan);
    expect(categoryText).toContain('service_categories_business_name_uq');
    const [namePlan] = await h.owner`EXPLAIN (FORMAT JSON) SELECT DISTINCT lower(name_en) AS key
      FROM services
      WHERE company_id = ${company}
        AND business_id = ${business}
        AND lower(name_en) = ANY(ARRAY['hair cut']::text[])`;
    const nameText = JSON.stringify(namePlan?.[0] ?? namePlan);
    expect(nameText).toContain('services_company_business_id_key');
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
