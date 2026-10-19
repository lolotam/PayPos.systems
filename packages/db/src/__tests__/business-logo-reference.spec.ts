import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, USER, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, lockBusinessLogoReference, type Database } from '../index.ts';

const FILE_ID = '01920000-0000-7000-8000-0000000000c1';
const OTHER_ID = '01920000-0000-7000-8000-0000000000c2';
let testDb: TestDatabase;
let database: Database;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  database = createDatabase({ url: testDb.appUrl, ids: systemUuidV7(), maxConnections: 2 });
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await database.close();
  await owner.end();
  await testDb.drop();
});

const lock = (fileId: string) =>
  database.withTenant(TENANT.A.company, (tx) =>
    lockBusinessLogoReference(tx, TENANT.A.company, TENANT.A.business, fileId),
  );

describe('lockBusinessLogoReference', () => {
  it('returns false and inserts an empty settings row when none exists', async () => {
    await owner`DELETE FROM business_settings
      WHERE company_id = ${TENANT.A.company} AND business_id = ${TENANT.A.business}`;
    expect(await lock(OTHER_ID)).toBe(false);
    const [row] = await owner`SELECT logo_file_id FROM business_settings
      WHERE company_id = ${TENANT.A.company} AND business_id = ${TENANT.A.business}`;
    expect(row?.['logo_file_id']).toBeNull();
  });

  it('returns true only while that file is the bound logo', async () => {
    await owner`INSERT INTO file_objects(
        company_id, id, business_id, owner_module, owner_entity_id, staging_key, storage_key,
        content_type, size_bytes, required_permission, created_by, created_at, status)
      VALUES (
        ${TENANT.A.company}, ${FILE_ID}, ${TENANT.A.business}, 'settings', ${TENANT.A.business},
        ${`staging-${FILE_ID}`}, ${`storage-${FILE_ID}`}, 'image/png', 10,
        'read:settings:business', ${USER}, ${new Date('2026-10-10T12:00:00Z')}, 'READY')`;
    await owner`INSERT INTO business_settings (company_id, business_id, logo_file_id)
      VALUES (${TENANT.A.company}, ${TENANT.A.business}, ${FILE_ID})
      ON CONFLICT (company_id, business_id) DO UPDATE SET logo_file_id = EXCLUDED.logo_file_id`;
    expect(await lock(FILE_ID)).toBe(true);
    expect(await lock(OTHER_ID)).toBe(false);
    await owner`UPDATE business_settings SET logo_file_id = NULL
      WHERE company_id = ${TENANT.A.company} AND business_id = ${TENANT.A.business}`;
    expect(await lock(FILE_ID)).toBe(false);
  });
});
