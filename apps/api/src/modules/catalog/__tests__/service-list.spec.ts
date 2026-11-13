import { sql } from 'drizzle-orm';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { listServices, listServicesStatement } from '../queries/list-services.query.ts';
import { serviceDetail, serviceDetailStatement } from '../queries/service-detail.query.ts';
import {
  detailFor,
  insertServiceCategories,
  servicesFixture,
  termsFor,
  type ServiceFixture,
} from './services.fixture.ts';

const ids = systemUuidV7();
let f: ServiceFixture;
let records: Awaited<ReturnType<ServiceFixture['create']['execute']>>[];
let categories: Awaited<ReturnType<typeof insertServiceCategories>>;

beforeAll(async () => {
  f = await servicesFixture();
  categories = await insertServiceCategories(f);
  records = [];
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    records.push(
      await f.create.execute({
        companyId: f.company,
        userId: f.userId,
        businessId: f.business,
        input: termsFor(name),
      }),
    );
  }
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const list = (
  limit: number,
  cursor?: string,
  company = f.company,
  business = f.business,
  categoryId?: string,
) =>
  f.db.withTenant(company, (tx) =>
    listServices(tx, company, business, {
      limit,
      ...(cursor ? { cursor } : {}),
      ...(categoryId ? { category_id: categoryId } : {}),
    }),
  );

it('SV-08b lists exact DTO projections with stable cursor pages and no duplicate rows', async () => {
  const first = await list(2);
  expect(first.items).toEqual(
    records.slice(0, 2).map((record) => ({
      id: record.id,
      name_en: record.name_en,
      name_ar: record.name_ar,
      price: record.price,
      commission_rule: record.commission_rule,
      counts_toward_threshold: record.counts_toward_threshold,
      duration_minutes: record.duration_minutes,
      category_id: record.category_id,
      category: record.category,
      closed_at: null,
      revision: record.revision,
    })),
  );
  expect(first.next_cursor).toBe(records[1]?.id);
  expect(await list(2, first.next_cursor ?? undefined)).toEqual({
    items: [
      {
        id: records[2]?.id,
        name_en: records[2]?.name_en,
        name_ar: records[2]?.name_ar,
        price: records[2]?.price,
        commission_rule: records[2]?.commission_rule,
        counts_toward_threshold: records[2]?.counts_toward_threshold,
        duration_minutes: records[2]?.duration_minutes,
        category_id: records[2]?.category_id,
        category: records[2]?.category,
        closed_at: null,
        revision: records[2]?.revision,
      },
    ],
    next_cursor: null,
  });
});

it('SV-08c isolates another company and another business', async () => {
  expect(await list(20, undefined, f.otherCompany)).toEqual({ items: [], next_cursor: null });
  expect(await list(20, undefined, f.company, f.secondBusiness)).toEqual({
    items: [],
    next_cursor: null,
  });
});

it('SV-08d the list plan uses the company/business/id cursor index', async () => {
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${listServicesStatement(f.company, f.business, { limit: 20 })}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('services_company_business_id');
});

it('SV-08e the category filter narrows the list, keeps the cursor stable and uses the category index', async () => {
  const tagged = [];
  for (const name of ['Tagged A', 'Tagged B']) {
    tagged.push(
      await f.create.execute({
        companyId: f.company,
        userId: f.userId,
        businessId: f.business,
        input: { ...termsFor(name), category_id: categories.open },
      }),
    );
  }
  const untagged = await f.create.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor('Untagged'),
  });
  const filtered = await list(20, undefined, f.company, f.business, categories.open);
  expect(filtered.items.map((item) => item.id)).toEqual([tagged[0]?.id, tagged[1]?.id]);
  expect(filtered.items[0]?.category).toEqual({
    name_en: 'Open category',
    name_ar: 'تصنيف مفتوح',
    closed_at: null,
  });
  expect(filtered.items.map((item) => item.id)).not.toContain(untagged.id);
  const page = await list(1, undefined, f.company, f.business, categories.open);
  expect(page.items.map((item) => item.id)).toEqual([tagged[0]?.id]);
  expect(page.next_cursor).toBe(tagged[0]?.id);
  const next = await list(1, page.next_cursor ?? undefined, f.company, f.business, categories.open);
  expect(next.items.map((item) => item.id)).toEqual([tagged[1]?.id]);
  expect(next.next_cursor).toBeNull();
  // تصنيف نشاط تاني أو معرّف مش موجود: مفيش خدمات، والصفحة فاضية زي ما هي لعميل مالوش التصنيف.
  expect(await list(20, undefined, f.company, f.business, categories.otherBusiness)).toEqual({
    items: [],
    next_cursor: null,
  });
  expect(await list(20, undefined, f.company, f.business, ids.newId())).toEqual({
    items: [],
    next_cursor: null,
  });
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${listServicesStatement(f.company, f.business, { limit: 20, category_id: categories.open })}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('services_business_category_idx');
});

it('the detail projection shows the category label and the closed mark of a closed category', async () => {
  const closed = ids.newId();
  await f.h
    .owner`INSERT INTO service_categories (company_id,id,business_id,name_en,name_ar,visibility)
    VALUES (${f.company},${closed},${f.business},'Closing category','تصنيف بيتقفل','BUSINESS')`;
  const tagged = await f.create.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: { ...termsFor('Closing service'), category_id: closed },
  });
  await f.h.owner`UPDATE service_categories SET closed_at = now()
    WHERE company_id=${f.company} AND id=${closed}`;
  const detail = await detailFor(f, f.company, f.business, tagged.id);
  expect(detail?.category).toMatchObject({
    name_en: 'Closing category',
    name_ar: 'تصنيف بيتقفل',
  });
  expect(detail?.category?.closed_at).not.toBeNull();
});

it('the detail projection matches the contract and uses a tenant-scoped index', async () => {
  const record = records[0];
  if (record === undefined) throw new Error('Synthetic service fixture missing');
  const result = await f.db.withTenant(f.company, (tx) =>
    serviceDetail(tx, f.company, f.business, record.id),
  );
  expect(result).toEqual(record);
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${serviceDetailStatement(f.company, f.business, record.id)}`,
    );
  });
  expect(JSON.stringify(plan)).toMatch(/services_(company_business_id|pk)/);
});
