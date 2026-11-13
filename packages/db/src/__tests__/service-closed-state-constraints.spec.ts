import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

// قيود الإغلاق في قاعدة البيانات نفسها، عشان فتح التصنيف ما يرجّعش خدمة اتقفلت لوحدها (32b-cat-2).
const { A } = TENANT;
const CATEGORY = '01920000-0000-7000-8000-0000000005c1';
const OTHER_CATEGORY = '01920000-0000-7000-8000-0000000005c2';
const CLOSED_AT = '2026-11-12T09:00:00Z';

let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO service_categories (company_id, id, business_id, name_en, name_ar, visibility)
    VALUES (${A.company}, ${CATEGORY}, ${A.business}, 'First category', 'تصنيف أول', 'BUSINESS'),
      (${A.company}, ${OTHER_CATEGORY}, ${A.business}, 'Second category', 'تصنيف تاني', 'BUSINESS')`;
});

afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

let sequence = 0;

const insertService = (
  categoryId: string | null,
  closedAt: string | null,
  closedByCategoryId: string | null,
) => {
  sequence += 1;
  const id = `01920000-0000-7000-8000-0000000006${sequence.toString().padStart(2, '0')}`;
  return owner`INSERT INTO services (company_id, id, business_id, name_en, price, commission_rule_kind,
      category_id, closed_at, closed_by_category_id)
    VALUES (${A.company}, ${id}, ${A.business}, ${`Service ${sequence}`}, 1.000, 'ZERO',
      ${categoryId}, ${closedAt}, ${closedByCategoryId})
    RETURNING id`;
};

async function rejectsWith(work: Promise<unknown>, expected: RegExp): Promise<void> {
  const error = await work.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(cause instanceof Error ? cause.message : (error as Error).message).toMatch(expected);
}

describe('services — the closed-category marker is consistent', () => {
  it('refuses a marker without a closed timestamp', async () => {
    await rejectsWith(
      insertService(CATEGORY, null, CATEGORY),
      /services_closed_marker_requires_closed/,
    );
  });

  it('refuses a marker of another category and a marker with no category', async () => {
    await rejectsWith(
      insertService(CATEGORY, CLOSED_AT, OTHER_CATEGORY),
      /services_closed_marker_is_category/,
    );
    await rejectsWith(
      insertService(null, CLOSED_AT, CATEGORY),
      /services_closed_marker_is_category/,
    );
  });

  it('accepts open, independently closed and category-closed services', async () => {
    expect(Array.from(await insertService(CATEGORY, null, null))).toHaveLength(1);
    expect(Array.from(await insertService(CATEGORY, CLOSED_AT, null))).toHaveLength(1);
    expect(Array.from(await insertService(CATEGORY, CLOSED_AT, CATEGORY))).toHaveLength(1);
  });
});

describe('services — the closed-state constraints are validated', () => {
  it('the migrations left nothing NOT VALID behind', async () => {
    const rows = await owner`
      SELECT conname, convalidated FROM pg_constraint
      WHERE conrelid = 'services'::regclass
        AND conname IN ('services_closed_marker_requires_closed', 'services_closed_marker_is_category')
      ORDER BY conname`;
    expect(rows).toEqual([
      { conname: 'services_closed_marker_is_category', convalidated: true },
      { conname: 'services_closed_marker_requires_closed', convalidated: true },
    ]);
  });
});
