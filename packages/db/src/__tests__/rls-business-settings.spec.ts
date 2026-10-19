import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

// T10-3: business_settings is tenant data — one company never reads or changes another's settings.
const { A, B } = TENANT;
// A second business of B with no settings row, so a refused insert can only be RLS, never a duplicate key.
const B_BARE = '01920000-0000-7000-8000-0000000000b9';

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO business_settings (company_id, business_id, default_language)
                VALUES (${B.company}, ${B.business}, 'en')`;
    await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
                VALUES (${B_BARE}, ${B.company}, 'retail', 'Bare B')`;
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

async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return '';
  } catch (error) {
    const cause = error instanceof Error && 'cause' in error ? error.cause : error;
    return cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error);
  }
}

async function otherTenantNamesStayHidden(): Promise<void> {
  expect(await asA(sql`SELECT business_id FROM business_settings WHERE business_id = ${B.business}`)).toEqual([]);
  expect(
    await asA(sql`UPDATE business_settings SET official_name_en = 'Other'
      WHERE business_id = ${B.business} RETURNING business_id`),
  ).toEqual([]);
}

async function officialNameLength(): Promise<void> {
  expect(await refusal(asA(sql`UPDATE business_settings SET official_name_ar = '' WHERE business_id = ${A.business}`)))
    .toMatch(/business_settings_official_name_ar/);
  expect(
    await refusal(asA(sql`UPDATE business_settings SET official_name_en = ${'a'.repeat(256)}
      WHERE business_id = ${A.business}`)),
  ).toMatch(/business_settings_official_name_en/);
  expect(
    await asA(sql`UPDATE business_settings SET official_name_ar = ${'ا'.repeat(255)}
      WHERE business_id = ${A.business} RETURNING char_length(official_name_ar) AS n`),
  ).toEqual([{ n: 255 }]);
}

async function logoFileBinding(): Promise<void> {
  const fileA = '01920000-0000-7000-8000-0000000000c1';
  const fileB = '01920000-0000-7000-8000-0000000000c2';
  const otherBusiness = '01920000-0000-7000-8000-0000000000a9';
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO file_objects
      (company_id,id,business_id,owner_module,owner_entity_id,staging_key,content_type,size_bytes,required_permission,created_by,created_at)
      VALUES (${A.company},${fileA},${A.business},'settings',${A.business},'identity-logo-a','image/png',10,'read:settings:business',${USER},now())`;
    await owner`INSERT INTO file_objects
      (company_id,id,business_id,owner_module,owner_entity_id,staging_key,content_type,size_bytes,required_permission,created_by,created_at)
      VALUES (${B.company},${fileB},${B.business},'settings',${B.business},'identity-logo-b','image/png',10,'read:settings:business',${USER},now())`;
    await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
      VALUES (${otherBusiness}, ${A.company}, 'salon', 'Second A')`;
  } finally {
    await owner.end();
  }
  expect(await refusal(asA(sql`UPDATE business_settings SET logo_file_id = ${fileB} WHERE business_id = ${A.business}`)))
    .toMatch(/business_settings_logo_file_fk/);
  expect(
    await asA(sql`UPDATE business_settings SET logo_file_id = ${fileA}
      WHERE business_id = ${A.business} RETURNING logo_file_id`),
  ).toEqual([{ logo_file_id: fileA }]);
  expect(
    await refusal(asA(sql`INSERT INTO business_settings (company_id, business_id, logo_file_id)
      VALUES (${A.company}, ${otherBusiness}, ${fileA})`)),
  ).toMatch(/business_settings_logo_file_key/);
  const blocked = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await refusal(blocked`DELETE FROM file_objects WHERE company_id = ${A.company} AND id = ${fileA}`))
      .toMatch(/business_settings_logo_file_fk/);
  } finally {
    await blocked.end();
  }
}

describe('business_settings under RLS', () => {
  it("company A reads none of B's settings", async () => {
    expect(await asA(sql`SELECT business_id FROM business_settings`)).toEqual([]);
  });

  it("A cannot write settings for B, nor change B's", async () => {
    const refused = await asA(sql`INSERT INTO business_settings (company_id, business_id, calendar)
                                  VALUES (${B.company}, ${B_BARE}, 'hijri')`).catch(
      (error: unknown) => String((error as { cause?: unknown }).cause),
    );
    expect(refused).toMatch(/row-level security/);
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

  it('the same insert for its own business is accepted — the payload itself is valid', async () => {
    expect(
      await asA(sql`INSERT INTO business_settings (company_id, business_id, calendar)
                    VALUES (${A.company}, ${A.business}, 'hijri') RETURNING business_id`),
    ).toEqual([{ business_id: A.business }]);
  });

  it('only known languages and calendars; nobody deletes settings', async () => {
    await expect(
      asA(sql`INSERT INTO business_settings (company_id, business_id, default_language)
              VALUES (${A.company}, ${A.business}, 'fr')
              ON CONFLICT (company_id, business_id) DO UPDATE SET default_language = 'fr'`),
    ).rejects.toThrow();
    await expect(asA(sql`DELETE FROM business_settings`)).rejects.toThrow();
  });

  it("A cannot read or change B's official names", otherTenantNamesStayHidden);
  it('rejects a blank or 256-character official name and accepts 255', officialNameLength);
  it("refuses another company's file id and a second business sharing the same logo", logoFileBinding);
});
