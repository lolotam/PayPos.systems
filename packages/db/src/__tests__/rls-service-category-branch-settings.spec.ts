import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const CATEGORY_ID = '01920000-0000-7000-8000-0000000005e4';
const SETTING_ID = '01920000-0000-7000-8000-0000000005e5';
const OTHER_ID = '01920000-0000-7000-8000-0000000005e6';
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

function category(companyId: string, businessId: string) {
  return sql`INSERT INTO service_categories(company_id,id,business_id,name_en,name_ar,visibility)
    VALUES (${companyId},${CATEGORY_ID},${businessId},'Hair Care','صبغة','BUSINESS')`;
}

function setting(companyId: string, businessId: string, branchId: string, id = SETTING_ID) {
  return sql`INSERT INTO service_category_branch_settings
    (company_id,id,business_id,branch_id,category_id,state)
    VALUES (${companyId},${id},${businessId},${branchId},${CATEGORY_ID},'ENABLED') RETURNING id`;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO service_categories(company_id,id,business_id,name_en,name_ar,visibility)
    VALUES (${B.company},${CATEGORY_ID},${B.business},'Sentinel B','صبغة','BUSINESS')`;
  await owner`INSERT INTO service_category_branch_settings
    (company_id,id,business_id,branch_id,category_id,state)
    VALUES (${B.company},${SETTING_ID},${B.business},${B.branch},${CATEGORY_ID},'HIDDEN')`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => SETTING_ID } });
});

afterAll(async () => {
  await db.close();
  await owner.end();
  await testDb.drop();
});

const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));

async function rejectsWith(work: Promise<unknown>, expected: RegExp): Promise<void> {
  const error = await work.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(cause instanceof Error ? cause.message : (error as Error).message).toMatch(expected);
}

describe('service_category_branch_settings — forced tenant isolation', () => {
  it('enables and forces RLS; a cross-tenant read returns no rows and a cross-tenant write fails', async () => {
    const [row] = await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE oid='service_category_branch_settings'::regclass`;
    expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    expect(Array.from(await asA(sql`SELECT id FROM service_category_branch_settings`))).toEqual([]);
    await rejectsWith(asA(setting(B.company, B.business, B.branch, OTHER_ID)), /row-level security/);
    expect(
      Array.from(
        await asA(sql`UPDATE service_category_branch_settings SET state='ENABLED'
          WHERE company_id=${B.company} RETURNING id`),
      ),
    ).toEqual([]);
  });

  it('allows the same ids in A without exposing B and refuses cross-business references', async () => {
    await asA(category(A.company, A.business));
    expect(Array.from(await asA(setting(A.company, A.business, A.branch)))).toEqual([
      { id: SETTING_ID },
    ]);
    expect(
      Array.from(await asA(sql`SELECT state FROM service_category_branch_settings WHERE id=${SETTING_ID}`)),
    ).toEqual([{ state: 'ENABLED' }]);
    expect(
      await owner`SELECT state FROM service_category_branch_settings
        WHERE company_id=${B.company} AND id=${SETTING_ID}`,
    ).toEqual([{ state: 'HIDDEN' }]);
    await rejectsWith(
      asA(setting(A.company, A.business, B.branch, OTHER_ID)),
      /service_category_branch_settings_branch_fk/,
    );
  });
});

describe('service_category_branch_settings — minimal grants and indexes', () => {
  it('updates only state, revision and updated_at, and never deletes or moves identity columns', async () => {
    expect(
      Array.from(
        await asA(sql`UPDATE service_category_branch_settings
          SET state='HIDDEN',revision=2,updated_at=now() WHERE id=${SETTING_ID} RETURNING revision`),
      ),
    ).toEqual([{ revision: 2 }]);
    for (const statement of [
      sql`UPDATE service_category_branch_settings SET company_id=${B.company} WHERE id=${SETTING_ID}`,
      sql`UPDATE service_category_branch_settings SET business_id=${B.business} WHERE id=${SETTING_ID}`,
      sql`UPDATE service_category_branch_settings SET branch_id=${B.branch} WHERE id=${SETTING_ID}`,
      sql`UPDATE service_category_branch_settings SET category_id=${OTHER_ID} WHERE id=${SETTING_ID}`,
      sql`DELETE FROM service_category_branch_settings WHERE id=${SETTING_ID}`,
    ])
      await rejectsWith(asA(statement), /permission denied/);
  });

  it('ships exactly the primary, unique branch-category and two foreign-key indexes', async () => {
    const indexes = await owner`SELECT indexname FROM pg_indexes
      WHERE tablename='service_category_branch_settings' ORDER BY indexname`;
    expect(indexes.map((row) => row['indexname'])).toEqual([
      'service_category_branch_settings_branch_category_uq',
      'service_category_branch_settings_branch_idx',
      'service_category_branch_settings_category_idx',
      'service_category_branch_settings_pkey',
    ]);
  });

  it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
    'foreign runtime role %s has no access',
    async (url) => {
      const role = postgres(testDb[url], { max: 1, onnotice: () => undefined });
      try {
        await expect(role`SELECT id FROM service_category_branch_settings`).rejects.toThrow(
          /permission denied/,
        );
      } finally {
        await role.end();
      }
    },
  );
});
