import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT } from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { businessTimeZone, businessTimeZoneStatement } from '../business-time-zone.query.ts';

// CLAUDE.md §9: شكل النتيجة وخطة الفهرس لقراءة توقيت النشاط التي تستخدمها شارة وثائق الموظفين.
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

it('returns the business timezone inside its tenant and nothing for another tenant', async () => {
  const { A, B } = TENANT;
  expect(await db.withTenant(A.company, (tx) => businessTimeZone(tx, A.company, A.business))).toBe(
    'Asia/Kuwait',
  );
  expect(await db.withTenant(B.company, (tx) => businessTimeZone(tx, A.company, A.business))).toBe(
    null,
  );
});

it('plans on the tenant primary key', async () => {
  const { A } = TENANT;
  const plan = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${businessTimeZoneStatement(A.company, A.business)}`,
    );
  });
  expect(JSON.stringify(plan)).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
});
