import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { listServiceCategoriesStatement } from '../queries/service-categories.query.ts';
import {
  listFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

let f: ServiceCategoryFixture;
let records: Awaited<ReturnType<ServiceCategoryFixture['create']['execute']>>[];

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  records = [];
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    records.push(
      await f.create.execute({
        companyId: f.company,
        userId: f.userId,
        businessId: f.business,
        input: { name_en: name, name_ar: 'تصنيف تجريبي' },
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
  status: 'open' | 'closed' | 'all' = 'open',
) => listFor(f, company, business, { limit, status, ...(cursor ? { cursor } : {}) });

const shape = (record: (typeof records)[number] | undefined) => {
  if (record === undefined) throw new Error('Synthetic category fixture missing');
  return {
    id: record.id,
    name_en: record.name_en,
    name_ar: record.name_ar,
    visibility: record.visibility,
    owner_branch_id: record.owner_branch_id,
    closed_at: record.closed_at,
    revision: record.revision,
  };
};

it('SC-13 lists the exact DTO shape ordered by the key with stable cursor pages', async () => {
  const first = await list(2);
  expect(first.items).toEqual([shape(records[0]), shape(records[1])]);
  expect(first.next_cursor).toBe(JSON.stringify(['bravo', records[1]?.id]));
  const second = await list(2, first.next_cursor ?? undefined);
  expect(second.items).toEqual([shape(records[2])]);
  expect(second.next_cursor).toBeNull();
});

it('SC-14 isolates another company and another business', async () => {
  expect(await list(20, undefined, f.otherCompany)).toEqual({ items: [], next_cursor: null });
  expect(await list(20, undefined, f.company, f.secondBusiness)).toEqual({
    items: [],
    next_cursor: null,
  });
});

it('SC-15 the status filter picks open, closed or all', async () => {
  await f.h.owner`UPDATE service_categories SET closed_at=now() WHERE name_en='Charlie'`;
  expect((await list(20)).items.map((item) => item.name_en)).toEqual(['Alpha', 'Bravo']);
  expect((await list(20, undefined, f.company, f.business, 'closed')).items).toEqual([
    expect.objectContaining({ name_en: 'Charlie', closed_at: expect.any(String) }),
  ]);
  expect((await list(20, undefined, f.company, f.business, 'all')).items).toHaveLength(3);
});

it('SC-16 the list plan uses the business-wide name index', async () => {
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${listServiceCategoriesStatement(f.company, f.business, { limit: 20, status: 'open' })}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('service_categories_business_name_uq');
});
