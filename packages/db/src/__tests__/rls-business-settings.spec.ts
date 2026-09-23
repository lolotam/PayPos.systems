import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

// T10-3: business_settings is tenant data — one company never reads or changes another's settings.
const { A, B } = TENANT;

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO business_settings (company_id, business_id, default_language)
                VALUES (${B.company}, ${B.business}, 'en')`;
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.business } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

const asA = (query: ReturnType<typeof sql>) =>
  db.withTenant(A.company, async (tx) => Array.from(await tx.execute(query)));

describe('business_settings under RLS', () => {
  it("company A reads none of B's settings", async () => {
    expect(await asA(sql`SELECT business_id FROM business_settings`)).toEqual([]);
  });

  it("A cannot write settings for B, nor change B's", async () => {
    await expect(
      asA(sql`INSERT INTO business_settings (company_id, business_id, calendar)
              VALUES (${B.company}, ${B.business}, 'hijri')`),
    ).rejects.toThrow();
    expect(
      await asA(sql`UPDATE business_settings SET calendar = 'hijri' RETURNING business_id`),
    ).toEqual([]);
  });

  it("settings under A cannot point at B's business — the tenant-qualified FK refuses it", async () => {
    await expect(
      asA(sql`INSERT INTO business_settings (company_id, business_id)
              VALUES (${A.company}, ${B.business})`),
    ).rejects.toThrow();
  });

  it('only known languages and calendars; nobody deletes settings', async () => {
    await expect(
      asA(sql`INSERT INTO business_settings (company_id, business_id, default_language)
              VALUES (${A.company}, ${A.business}, 'fr')`),
    ).rejects.toThrow();
    await expect(asA(sql`DELETE FROM business_settings`)).rejects.toThrow();
  });
});
