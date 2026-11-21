import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT } from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { businessCountry, businessCountryStatement } from '../business-country.query.ts';

// 34-pre-3 B-9: شكل نتيجة قارئ دولة النشاط — محدد وغير محدد وقيمة مخزّنة قبل هذا التسليم — وعزل الشركة وخطة الفهرس.
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

const setSettings = (company: string, business: string, settings: unknown) =>
  db.withTenant(company, (tx) =>
    tx.execute(
      sql`UPDATE businesses SET settings = ${JSON.stringify(settings)}::jsonb WHERE company_id = ${company} AND id = ${business}`,
    ),
  );

it('reads the stored valid code inside its tenant', async () => {
  const { A } = TENANT;
  await setSettings(A.company, A.business, { modules: ['pos'], features: ['tables'], country: 'KW' });
  expect(await db.withTenant(A.company, (tx) => businessCountry(tx, A.company, A.business))).toEqual({
    country: 'KW',
  });
});

it('reads a business with no country key as unset', async () => {
  const { B } = TENANT;
  await setSettings(B.company, B.business, { currency: 'KWD', timezone: 'Asia/Kuwait' });
  expect(await db.withTenant(B.company, (tx) => businessCountry(tx, B.company, B.business))).toEqual({
    country: null,
  });
});

it('reads an absent settings record and a stored invalid value as unset, never raw JSON', async () => {
  const { A } = TENANT;
  await setSettings(A.company, A.business, null);
  expect(await db.withTenant(A.company, (tx) => businessCountry(tx, A.company, A.business))).toEqual({
    country: null,
  });
  await setSettings(A.company, A.business, { country: 'EG' });
  expect(await db.withTenant(A.company, (tx) => businessCountry(tx, A.company, A.business))).toEqual({
    country: null,
  });
  await setSettings(A.company, A.business, { country: 965 });
  expect(await db.withTenant(A.company, (tx) => businessCountry(tx, A.company, A.business))).toEqual({
    country: null,
  });
  expect(
    await db.withTenant(A.company, (tx) => businessCountry(tx, A.company, A.business)),
  ).not.toHaveProperty('raw');
});

it('answers null for another tenant business instead of a value', async () => {
  const { A, B } = TENANT;
  expect(await db.withTenant(B.company, (tx) => businessCountry(tx, B.company, A.business))).toBeNull();
  expect(
    await db.withTenant(A.company, (tx) => businessCountry(tx, A.company, '01920000-0000-7000-8000-00000000ffff')),
  ).toBeNull();
});

it('plans on the tenant primary key', async () => {
  const { A } = TENANT;
  const plan = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${businessCountryStatement(A.company, A.business)}`,
    );
  });
  expect(JSON.stringify(plan)).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
});
