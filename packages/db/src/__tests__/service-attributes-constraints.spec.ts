import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

// المدة والتصنيف قيدان في قاعدة البيانات نفسها مش في التطبيق بس (032b-pre-1).
// الـ CHECK بيمنع مدة برّه 1..600، والمفتاح المركّب بيمنع تصنيف نشاط تاني في نفس الشركة.
const { A } = TENANT;
const SECOND_BUSINESS = '01920000-0000-7000-8000-0000000000a3';
const CATEGORY = '01920000-0000-7000-8000-0000000005c1';
const OTHER_BUSINESS_CATEGORY = '01920000-0000-7000-8000-0000000005c2';

let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
    VALUES (${SECOND_BUSINESS}, ${A.company}, 'salon', 'Second business')`;
  await owner`INSERT INTO service_categories (company_id, id, business_id, name_en, name_ar, visibility)
    VALUES (${A.company}, ${CATEGORY}, ${A.business}, 'Open category', 'تصنيف مفتوح', 'BUSINESS')`;
  await owner`INSERT INTO service_categories (company_id, id, business_id, name_en, name_ar, visibility)
    VALUES (${A.company}, ${OTHER_BUSINESS_CATEGORY}, ${SECOND_BUSINESS}, 'Other category', 'تصنيف تاني', 'BUSINESS')`;
});

afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

let sequence = 0;

const insertService = (durationMinutes: number | null, categoryId: string | null) => {
  sequence += 1;
  const id = `01920000-0000-7000-8000-0000000006${sequence.toString().padStart(2, '0')}`;
  return owner`INSERT INTO services (company_id, id, business_id, name_en, price, commission_rule_kind,
      duration_minutes, category_id)
    VALUES (${A.company}, ${id}, ${A.business}, ${`Service ${sequence}`}, 1.000, 'ZERO',
      ${durationMinutes}, ${categoryId})
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

describe('services — the duration bound is a database check', () => {
  it('refuses 0 and 601', async () => {
    await rejectsWith(insertService(0, null), /services_duration_bounds/);
    await rejectsWith(insertService(601, null), /services_duration_bounds/);
  });

  it('accepts the two ends of the range and no value at all', async () => {
    expect(Array.from(await insertService(1, null))).toHaveLength(1);
    expect(Array.from(await insertService(600, null))).toHaveLength(1);
    expect(Array.from(await insertService(null, null))).toHaveLength(1);
  });
});

describe('services — the category key carries the business', () => {
  it('refuses a category of another business of the same company', async () => {
    await rejectsWith(insertService(30, OTHER_BUSINESS_CATEGORY), /services_category_fk/);
  });

  it('accepts a category of the same business', async () => {
    expect(Array.from(await insertService(30, CATEGORY))).toHaveLength(1);
  });
});

describe('services — both constraints are validated', () => {
  it('the migrations left nothing NOT VALID behind', async () => {
    const rows = await owner`
      SELECT conname, convalidated FROM pg_constraint
      WHERE conrelid = 'services'::regclass
        AND conname IN ('services_duration_bounds', 'services_category_fk')
      ORDER BY conname`;
    expect(rows).toEqual([
      { conname: 'services_category_fk', convalidated: true },
      { conname: 'services_duration_bounds', convalidated: true },
    ]);
  });
});
