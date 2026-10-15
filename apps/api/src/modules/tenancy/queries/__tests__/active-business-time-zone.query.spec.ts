import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT } from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import {
  activeBusinessTimeZone,
  activeBusinessTimeZoneStatement,
} from '../active-business-time-zone.query.ts';

// CLAUDE.md §9: شكل النتيجة وخطة الفهرس لقراءة مكان الجلسة التي يشاركها الإثبات.
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

it('returns the business timezone for an active branch and nothing otherwise', async () => {
  const { A, B } = TENANT;
  const read = (companyId: string, businessId: string, branchId: string) =>
    db.withTenant(A.company, (tx) => activeBusinessTimeZone(tx, companyId, businessId, branchId));
  expect(await read(A.company, A.business, A.branch)).toBe('Asia/Kuwait');
  expect(
    await db.withTenant(B.company, (tx) => activeBusinessTimeZone(tx, A.company, A.business, A.branch)),
  ).toBeNull();
  expect(await read(A.company, B.business, A.branch)).toBeNull();
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`UPDATE branches SET is_active = false WHERE company_id = ${A.company} AND id = ${A.branch}`;
    expect(await read(A.company, A.business, A.branch)).toBeNull();
    await owner`UPDATE branches SET is_active = true WHERE company_id = ${A.company} AND id = ${A.branch}`;
    await owner`UPDATE companies SET deleted_at = now() WHERE id = ${A.company}`;
    expect(await read(A.company, A.business, A.branch)).toBeNull();
  } finally {
    await owner`UPDATE branches SET is_active = true WHERE company_id = ${A.company} AND id = ${A.branch}`;
    await owner`UPDATE companies SET deleted_at = NULL WHERE id = ${A.company}`;
    await owner.end();
  }
});

it('plans the branch lookup on a tenant index', async () => {
  const { A } = TENANT;
  const plan = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${activeBusinessTimeZoneStatement(A.company, A.business, A.branch)}`,
    );
  });
  expect(JSON.stringify(plan)).toMatch(/branches_(pkey|company_business_id_key)/);
});
