import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT } from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { businessNames } from '../business-names.query.ts';

// CLAUDE.md §9: شكل النتيجة لقراءة أسماء النشاط التي تعرضها صفحة التقييم العامة.
let testDb: TestDatabase;
let db: Database;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: systemUuidV7() });
});
afterAll(async () => {
  await db?.close();
  await testDb?.drop();
});

it('returns the business names inside its tenant and nothing for another tenant', async () => {
  const { A, B } = TENANT;
  expect(await db.withTenant(A.company, (tx) => businessNames(tx, A.company, A.business))).toEqual({
    name_ar: null,
    name_en: 'Business A',
  });
  expect(await db.withTenant(B.company, (tx) => businessNames(tx, A.company, A.business))).toBe(
    null,
  );
});

it('reads the Arabic name when the business has one', async () => {
  const { A } = TENANT;
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`UPDATE businesses SET name_ar='Activity in Arabic'
      WHERE company_id=${A.company} AND id=${A.business}`;
  } finally {
    await owner.end();
  }
  expect(await db.withTenant(A.company, (tx) => businessNames(tx, A.company, A.business))).toEqual({
    name_ar: 'Activity in Arabic',
    name_en: 'Business A',
  });
});
