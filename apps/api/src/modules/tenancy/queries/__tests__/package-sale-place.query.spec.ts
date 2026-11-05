import {
  createDatabase,
  PROVISIONAL_PLAN_ID,
  type Database,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { packageSalePlace } from '../package-sale-place.query.ts';

// CLAUDE.md §9: the package place read has a result-shape test and an EXPLAIN ANALYZE assertion on a seeded dataset.
const { A, B } = TENANT;
const NORTH = '01920000-0000-7000-8000-0000000000a4';
const CLOSED = '01920000-0000-7000-8000-0000000000a5';

let testDb: TestDatabase;
let db: Database;
const plans: string[] = [];

function explaining(database: Database): TenantWrappers {
  const explain = (tx: Tx): Tx =>
    new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              const [row] = await target.execute<{ plan: unknown }>(
                sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`,
              );
              plans.push(JSON.stringify(Object.values(row ?? {})[0]));
              return target.execute(query);
            }
          : Reflect.get(target, property, receiver),
    });
  return {
    withUser: (userId, fn) => database.withUser(userId, (tx) => fn(explain(tx))),
    withNewTenant: (userId, fn) => database.withNewTenant(userId, (tx, id) => fn(explain(tx), id)),
    withMember: (userId, companyId, fn) =>
      database.withMember(userId, companyId, (tx) => fn(explain(tx))),
    withTenant: (companyId, fn, options) =>
      database.withTenant(companyId, (tx) => fn(explain(tx)), options),
  };
}

function read(companyId: string, businessId: string, branchId: string) {
  return db.withTenant(companyId, (tx) => packageSalePlace(tx, companyId, businessId, branchId), {
    userId: USER,
  });
}

async function seedVolume(ownerUrl: string): Promise<void> {
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`
      INSERT INTO companies (id, name_en, owner_user_id, plan_id)
      SELECT gen_random_uuid(), 'Bulk ' || n, ${USER}, ${PROVISIONAL_PLAN_ID}
      FROM generate_series(1, 800) AS n`;
    await owner`
      INSERT INTO businesses (id, company_id, vertical_type, name_en)
      SELECT gen_random_uuid(), c.id, 'retail', 'Shop ' || s
      FROM (SELECT id FROM companies WHERE name_en LIKE 'Bulk %' LIMIT 40) AS c
      CROSS JOIN generate_series(1, 15) AS s`;
    await owner`
      INSERT INTO branches (id, company_id, business_id, name_en)
      SELECT gen_random_uuid(), b.company_id, b.id, 'Desk ' || s
      FROM businesses b
      CROSS JOIN generate_series(1, 3) AS s
      WHERE b.name_en LIKE 'Shop %'`;
    await owner`ANALYZE companies, businesses, branches`;
  } finally {
    await owner.end();
  }
}

async function shapeBranches(ownerUrl: string): Promise<void> {
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`
      UPDATE businesses SET timezone = 'Asia/Qatar'
      WHERE company_id = ${A.company} AND id = ${A.business}`;
    await owner`
      UPDATE branches SET timezone = NULL
      WHERE company_id = ${A.company} AND id = ${A.branch}`;
    await owner`
      INSERT INTO branches (id, company_id, business_id, name_en, timezone, is_active)
      VALUES (${NORTH}, ${A.company}, ${A.business}, 'North', 'Europe/London', true),
             (${CLOSED}, ${A.company}, ${A.business}, 'Closed', 'Asia/Riyadh', false)`;
  } finally {
    await owner.end();
  }
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  await seedVolume(testDb.ownerUrl);
  await shapeBranches(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('packageSalePlace', () => {
  it('returns the branch timezone when the branch has one', async () => {
    expect(await read(A.company, A.business, NORTH)).toBe('Europe/London');
  });

  it('falls back to the business timezone when the branch has none', async () => {
    expect(await read(A.company, A.business, A.branch)).toBe('Asia/Qatar');
  });

  it('returns null for a branch of another company, an inactive branch and an unknown branch', async () => {
    expect(await read(A.company, A.business, B.branch)).toBeNull();
    expect(await read(A.company, A.business, CLOSED)).toBeNull();
    expect(await read(A.company, A.business, '01920000-0000-7000-8000-0000000000ff')).toBeNull();
  });

  it('EXPLAIN ANALYZE uses the tenant indexes and never a sequential scan', async () => {
    plans.length = 0;
    await explaining(db).withTenant(
      A.company,
      (tx) => packageSalePlace(tx, A.company, A.business, NORTH),
      { userId: USER },
    );
    const plan = plans.at(-1) ?? '';
    expect(
      plan.includes('branches_pkey') || plan.includes('branches_company_business_id_key'),
      plan,
    ).toBe(true);
    expect(plan.includes('businesses_pkey') || plan.includes('businesses_company_id_created_at_idx'), plan).toBe(true);
    expect(plan, plan).toContain('companies_pkey');
    expect(plan, plan).not.toContain('Seq Scan');
  });
});
