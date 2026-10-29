import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const ID = '01920000-0000-7000-8000-0000000005e2';
const OTHER_ID = '01920000-0000-7000-8000-0000000005e3';
// وقت الإغلاق نص بترميز ISO: مشغّل postgres بيقبل النصوص، وما بيقبلش Date كمعامل خام.
const CLOSED_AT = '2026-10-29T00:00:00.000Z';
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

interface CategoryInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId?: string;
  readonly id?: string;
  readonly name?: string;
  readonly visibility?: 'BUSINESS' | 'BRANCH';
  readonly closed?: boolean;
}

function insert(input: CategoryInput) {
  const visibility = input.visibility ?? 'BUSINESS';
  return sql`INSERT INTO service_categories
    (company_id,id,business_id,name_en,name_ar,owner_branch_id,visibility,closed_at)
    VALUES (${input.companyId},${input.id ?? ID},${input.businessId},${input.name ?? 'Hair Care'},'صبغة',
      ${input.branchId ?? null},${visibility},${input.closed === true ? CLOSED_AT : null})
    RETURNING id`;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO service_categories (company_id,id,business_id,name_en,name_ar,visibility)
    VALUES (${B.company},${ID},${B.business},'Sentinel B','صبغة','BUSINESS')`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => ID } });
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

describe('service_categories — forced tenant isolation', () => {
  it('enables and forces RLS, and the application role cannot bypass it', async () => {
    const [row] = await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE oid='service_categories'::regclass`;
    expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const [role] = await owner`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('A sees no B row and cannot insert under B or reference a foreign business or branch', async () => {
    expect(Array.from(await asA(sql`SELECT id FROM service_categories`))).toEqual([]);
    await rejectsWith(
      asA(insert({ companyId: B.company, businessId: B.business })),
      /row-level security/,
    );
    await rejectsWith(
      asA(insert({ companyId: A.company, businessId: B.business })),
      /service_categories_business_fk/,
    );
    await rejectsWith(
      asA(
        insert({
          companyId: A.company,
          businessId: A.business,
          branchId: B.branch,
          visibility: 'BRANCH',
        }),
      ),
      /service_categories_owner_branch_fk/,
    );
  });

  it('the same id in A and B is allowed without an existence oracle', async () => {
    expect(
      Array.from(await asA(insert({ companyId: A.company, businessId: A.business }))),
    ).toEqual([{ id: ID }]);
    expect(Array.from(await asA(sql`SELECT name_en FROM service_categories WHERE id=${ID}`))).toEqual([
      { name_en: 'Hair Care' },
    ]);
    expect(
      await owner`SELECT name_en FROM service_categories WHERE company_id=${B.company} AND id=${ID}`,
    ).toEqual([{ name_en: 'Sentinel B' }]);
  });
});

describe('service_categories — minimal grants', () => {
  it('cross-tenant update and upsert cannot move or expose a row; outside a tenant sees nothing', async () => {
    expect(
      Array.from(
        await asA(sql`UPDATE service_categories SET name_en='Overwritten'
          WHERE company_id=${B.company} AND id=${ID} RETURNING id`),
      ),
    ).toEqual([]);
    await rejectsWith(
      asA(sql`INSERT INTO service_categories(company_id,id,business_id,name_en,name_ar,visibility)
        VALUES (${B.company},${ID},${B.business},'Upsert','صبغة','BUSINESS')
        ON CONFLICT(company_id,id) DO UPDATE SET name_en=excluded.name_en`),
      /row-level security/,
    );
    const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      expect(await app`SELECT id FROM service_categories`).toEqual([]);
    } finally {
      await app.end();
    }
  });

  it('runtime cannot move tenant, business or owner branch, and cannot delete', async () => {
    await rejectsWith(
      asA(sql`UPDATE service_categories SET company_id=${B.company} WHERE id=${ID}`),
      /permission denied/,
    );
    await rejectsWith(
      asA(sql`UPDATE service_categories SET business_id=${B.business} WHERE id=${ID}`),
      /permission denied/,
    );
    await rejectsWith(
      asA(sql`UPDATE service_categories SET owner_branch_id=${A.branch} WHERE id=${ID}`),
      /permission denied/,
    );
    await rejectsWith(asA(sql`DELETE FROM service_categories WHERE company_id=${A.company}`), /permission denied/);
  });

  it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
    'foreign runtime role %s has no access',
    async (url) => {
      const role = postgres(testDb[url], { max: 1, onnotice: () => undefined });
      try {
        await expect(role`SELECT id FROM service_categories`).rejects.toThrow(/permission denied/);
      } finally {
        await role.end();
      }
    },
  );
});

describe('service_categories — names, visibility and indexes', () => {
  it('the business-wide key collides on case and remains reserved by a closed category', async () => {
    await rejectsWith(
      asA(insert({ companyId: A.company, businessId: A.business, id: OTHER_ID, name: 'hair care', closed: true })),
      /service_categories_business_name_uq/,
    );
  });

  it('requires stored normalized names, both name lengths and no controls', async () => {
    await rejectsWith(
      asA(insert({ companyId: A.company, businessId: A.business, id: OTHER_ID, name: ' Hair  Care ' })),
      /service_categories_name_en_normalized/,
    );
    await rejectsWith(
      asA(insert({ companyId: A.company, businessId: A.business, id: OTHER_ID, name: 'a'.repeat(101) })),
      /service_categories_name_en_length/,
    );
    await rejectsWith(
      asA(insert({ companyId: A.company, businessId: A.business, id: OTHER_ID, name: 'Ha\u0001ir' })),
      /service_categories_name_en_controls/,
    );
  });

  it('requires an owner branch only for a private category', async () => {
    await rejectsWith(
      asA(insert({ companyId: A.company, businessId: A.business, id: OTHER_ID, visibility: 'BRANCH' })),
      /service_categories_branch_owner_required/,
    );
    expect(
      Array.from(
        await asA(
          insert({
            companyId: A.company,
            businessId: A.business,
            id: OTHER_ID,
            name: 'Private Nails',
            branchId: A.branch,
            visibility: 'BRANCH',
          }),
        ),
      ),
    ).toEqual([{ id: OTHER_ID }]);
  });

  it('ships exactly the primary, service-FK, name and owner-branch indexes', async () => {
    const indexes = await owner`SELECT indexname FROM pg_indexes
      WHERE tablename='service_categories' ORDER BY indexname`;
    expect(indexes.map((row) => row['indexname'])).toEqual([
      'service_categories_business_name_uq',
      'service_categories_company_business_id_key',
      'service_categories_owner_branch_idx',
      'service_categories_pkey',
    ]);
  });
});
