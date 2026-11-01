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
  businessNames,
  businessNamesByIds,
  businessNamesByIdsStatement,
  businessNamesStatement,
} from '../business-names.query.ts';

// CLAUDE.md §9: شكل النتيجة وخطة الفهرس لقراءة أسماء النشاط التي تعرضها صفحة التقييم العامة.
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

it('plans the business lookup on the tenant primary key', async () => {
  const { A } = TENANT;
  const plan = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${businessNamesStatement(A.company, A.business)}`,
    );
  });
  expect(JSON.stringify(plan)).toMatch(/businesses_pkey/);
});

const REQUESTED = '01920000-0000-7000-8000-0000000000c1';

it('reads only the requested businesses of the company, in one pass', async () => {
  const { A, B } = TENANT;
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
      SELECT gen_random_uuid(), ${A.company}, 'retail', 'Bulk ' || n
      FROM generate_series(1, 5000) AS n`;
    await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
      VALUES (${REQUESTED}, ${A.company}, 'retail', 'Requested business')`;
  } finally {
    await owner.end();
  }
  const rows = await db.withTenant(A.company, (tx) =>
    businessNamesByIds(tx, A.company, [A.business, REQUESTED, B.business]),
  );
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.name_en).sort()).toEqual(['Business A', 'Requested business']);
  expect(rows.every((row) => row.id !== B.business)).toBe(true);
});

it('an empty set reads nothing at all', async () => {
  const { A } = TENANT;
  expect(await db.withTenant(A.company, (tx) => businessNamesByIds(tx, A.company, []))).toEqual([]);
});

it('plans the batch lookup on the tenant primary key with the normal planner settings', async () => {
  const { A } = TENANT;
  const plan = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`ANALYZE businesses`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${businessNamesByIdsStatement(A.company, [A.business])}`,
    );
  });
  const text = JSON.stringify(plan);
  expect(text).toMatch(/businesses_pkey/);
  expect(text).not.toMatch(/Seq Scan/);
});
