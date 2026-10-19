import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

// الأعمدة الجديدة على جدول قائم: مفيش منح عمود، والصلاحية جاية من منح الجدول نفسه.
let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

describe('business identity columns', () => {
  it('add no column grant and stay usable through the table privilege', async () => {
    const rows = await owner<{ column: string; acl: string | null }[]>`
      SELECT a.attname AS column, a.attacl::text AS acl
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'business_settings'
        AND a.attname IN ('official_name_ar', 'official_name_en', 'logo_file_id')
      ORDER BY 1`;
    expect(rows).toEqual([
      { column: 'logo_file_id', acl: null },
      { column: 'official_name_ar', acl: null },
      { column: 'official_name_en', acl: null },
    ]);
    const [usable] = await owner`
      SELECT has_column_privilege('pospay_app', 'business_settings', 'official_name_ar', 'SELECT') AS read_ar,
             has_column_privilege('pospay_app', 'business_settings', 'official_name_en', 'UPDATE') AS write_en,
             has_column_privilege('pospay_app', 'business_settings', 'logo_file_id', 'UPDATE') AS write_logo`;
    expect(usable).toEqual({ read_ar: true, write_en: true, write_logo: true });
  });
});
