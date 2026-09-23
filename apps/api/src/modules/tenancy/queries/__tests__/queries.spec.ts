import { branch as branchSchema, business as businessSchema, page } from '@pospay/contracts';
import { createDatabase, type Database, type TenantWrappers, type Tx } from '@pospay/db';
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
import { branchDetail } from '../branch-detail.query.ts';
import { InvalidCursorError, listBusinesses } from '../list-businesses.query.ts';

// CLAUDE.md §9: every queries/ file has a result-shape test and an EXPLAIN ANALYZE assertion on a seeded dataset.
// The query files run unchanged; the transaction they get also records the plan of each statement.
const { A } = TENANT;
const access = { companyId: A.company, userId: USER };

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
    withTenant: (companyId, fn, options) =>
      database.withTenant(companyId, (tx) => fn(explain(tx)), options),
  };
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    // A realistic spread: 40 companies × 50 businesses × 2 branches, so one company is a small slice of each table.
    await owner`
      INSERT INTO companies (id, name_en, owner_user_id, plan_id)
      SELECT gen_random_uuid(), 'Bulk ' || n, ${USER}, (SELECT id FROM plans LIMIT 1)
      FROM generate_series(1, 40) AS n`;
    await owner`
      INSERT INTO businesses (id, company_id, vertical_type, name_en, created_at)
      SELECT gen_random_uuid(), c.id, 'retail', 'B' || n, now() - n * interval '1 minute'
      FROM companies c CROSS JOIN generate_series(1, 50) AS n`;
    await owner`
      INSERT INTO branches (id, company_id, business_id, name_en)
      SELECT gen_random_uuid(), b.company_id, b.id, 'Branch ' || n
      FROM businesses b CROSS JOIN generate_series(1, 2) AS n`;
    await owner`ANALYZE businesses`;
    await owner`ANALYZE branches`;
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('list-businesses.query', () => {
  it('returns the Business shape, newest first, and pages with a cursor without gaps or repeats', async () => {
    const first = await listBusinesses(db, access, { limit: 20 });
    expect(page(businessSchema).parse(first).items).toHaveLength(20);
    const second = await listBusinesses(db, access, { limit: 20, cursor: first.next_cursor ?? '' });
    const third = await listBusinesses(db, access, { limit: 20, cursor: second.next_cursor ?? '' });
    const ids = [...first.items, ...second.items, ...third.items].map((b) => b.id);
    expect(new Set(ids).size).toBe(51);
    expect(third.next_cursor).toBeNull();
    const times = [...first.items, ...second.items].map((b) => Date.parse(b.created_at));
    expect(times).toEqual([...times].sort((x, y) => y - x));
    expect([...first.items, ...third.items].every((b) => b.company_id === A.company)).toBe(true);
  });

  it('refuses a cursor it did not issue', async () => {
    await expect(
      listBusinesses(db, access, { limit: 5, cursor: 'garbage' }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it('EXPLAIN ANALYZE: served by businesses_company_id_created_at_idx, never a sequential scan', async () => {
    plans.length = 0;
    await listBusinesses(explaining(db), access, { limit: 20 });
    const plan = plans.at(-1) ?? '';
    expect(plan).toContain('businesses_company_id_created_at_idx');
    expect(plan).not.toContain('Seq Scan');
  });
});

describe('branch-detail.query', () => {
  it('returns the Branch shape, or null for a branch of another company', async () => {
    const found = await branchDetail(db, access, A.branch);
    expect(branchSchema.parse(found)).toMatchObject({ id: A.branch, company_id: A.company });
    expect(await branchDetail(db, access, TENANT.B.branch)).toBeNull();
  });

  it('EXPLAIN ANALYZE: one primary-key lookup', async () => {
    plans.length = 0;
    await branchDetail(explaining(db), access, A.branch);
    const plan = plans.at(-1) ?? '';
    expect(plan).toContain('branches_pkey');
    expect(plan).not.toContain('Seq Scan');
  });
});
