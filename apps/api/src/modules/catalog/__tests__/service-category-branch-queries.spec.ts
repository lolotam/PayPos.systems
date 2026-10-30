import { serviceCategoryBranchListItem } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  listBranchServiceCategories,
  listBranchServiceCategoriesStatement,
} from '../queries/branch-service-categories.query.ts';
import {
  namesFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

let f: ServiceCategoryFixture;
let shared: { id: string };
let own: { id: string };
let other: { id: string };

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  const actor = { companyId: f.company, userId: f.userId, businessId: f.business };
  shared = await f.create.execute({ ...actor, input: namesFor('Alpha shared') });
  own = await f.create.execute({
    ...actor,
    branchId: f.branch,
    input: { ...namesFor('Bravo own'), visibility: 'BRANCH' },
  });
  other = await f.create.execute({
    ...actor,
    branchId: f.otherBranch,
    input: { ...namesFor('Charlie other'), visibility: 'BRANCH' },
  });
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function read(
  view: 'in_use' | 'available',
  limit = 20,
  cursor?: string,
  branch = f.branch,
  business = f.business,
) {
  return f.db.withTenant(f.company, (tx) =>
    listBranchServiceCategories(tx, f.company, business, branch, {
      view,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    }),
  );
}

async function set(categoryId: string, state: 'ENABLED' | 'HIDDEN', expected: number | null) {
  return f.setState.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    branchId: f.branch,
    categoryId,
    input: { state, expected_revision: expected },
  });
}

it('BCS-Q01 returns the exact DTO shape in key order with stable cursor pages and null settings', async () => {
  const first = await read('in_use', 1);
  expect(first.items).toEqual([
    serviceCategoryBranchListItem.parse({
      id: shared.id,
      name_en: 'Alpha shared',
      name_ar: 'تصنيف تجريبي',
      visibility: 'BUSINESS',
      owner_branch_id: null,
      closed_at: null,
      revision: 1,
      setting_state: null,
      setting_revision: null,
    }),
  ]);
  expect(first.next_cursor).toBe(JSON.stringify(['alpha shared', shared.id]));
  expect((await read('in_use', 1, first.next_cursor ?? undefined)).items[0]).toMatchObject({
    id: own.id,
    setting_state: null,
    setting_revision: null,
  });
  expect((await read('available')).items.map((item) => item.id)).toEqual([other.id]);
});

it('BCS-Q02 moves hidden and enabled categories between views with their stored setting revision', async () => {
  await set(shared.id, 'HIDDEN', null);
  expect((await read('in_use')).items.map((item) => item.id)).toEqual([own.id]);
  expect((await read('available')).items.map((item) => item.id)).toEqual([shared.id, other.id]);
  expect((await read('available')).items[0]).toMatchObject({
    setting_state: 'HIDDEN',
    setting_revision: 1,
  });
  await set(other.id, 'ENABLED', null);
  expect((await read('in_use')).items.map((item) => item.id)).toEqual([own.id, other.id]);
  expect((await read('available')).items.map((item) => item.id)).toEqual([shared.id]);
});

it('BCS-Q03 EXPLAIN ANALYZE uses the name key and settings unique key without sequential scans', async () => {
  for (const view of ['in_use', 'available'] as const) {
    const plan = await f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan=off`);
      return tx.execute(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${listBranchServiceCategoriesStatement(
          f.company,
          f.business,
          f.branch,
          { view, limit: 20 },
        )}`,
      );
    });
    const text = JSON.stringify(plan);
    expect(text).toContain('service_categories_business_name_uq');
    expect(text).toContain('service_category_branch_settings_branch_category_uq');
    expect(text).not.toContain('Seq Scan');
  }
});
