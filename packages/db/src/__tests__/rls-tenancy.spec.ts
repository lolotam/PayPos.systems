import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

// The whole suite runs as pospay_app through the real wrappers (plan v4 T5); the owner only seeds.
let testDb: TestDatabase;
let db: Database;

const { A, B } = TENANT;
const RLS = /row-level security/;

// Drizzle wraps a database error as "Failed query: …" and keeps Postgres' own error in `cause`.
const rejectsWith = async (work: Promise<unknown>, expected: RegExp): Promise<void> => {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, 'expected the statement to be refused').toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(String(cause instanceof Error ? cause.message : (error as Error).message)).toMatch(
    expected,
  );
};

const rows = (companyId: string, query: SQL) =>
  db.withTenant(companyId, async (tx) =>
    Array.from(await tx.execute<Record<string, unknown>>(query)),
  );

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  db = createDatabase({
    url: testDb.appUrl,
    ids: { newId: () => '01920000-0000-7000-8000-0000000000c0' },
  });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('cross-tenant reads return nothing', () => {
  it.each(['businesses', 'branches', 'company_feature_overrides'])(
    'company A sees only its own %s',
    async (table) => {
      const seen = await rows(A.company, sql`SELECT company_id FROM ${sql.identifier(table)}`);
      expect(seen).toEqual([{ company_id: A.company }]);
    },
  );

  it("reading B's business by id as A returns 0 rows", async () => {
    expect(await rows(A.company, sql`SELECT id FROM businesses WHERE id = ${B.business}`)).toEqual(
      [],
    );
  });

  it('a query outside withTenant() sees no tenant rows at all', async () => {
    const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      const [counts] = await app`SELECT (SELECT count(*) FROM businesses)::int AS businesses,
                                        (SELECT count(*) FROM branches)::int AS branches,
                                        (SELECT count(*) FROM companies)::int AS companies`;
      expect(counts).toEqual({ businesses: 0, branches: 0, companies: 0 });
    } finally {
      await app.end();
    }
  });
});

describe('cross-tenant writes are refused', () => {
  it('INSERT with another company_id is rejected by WITH CHECK', async () => {
    await rejectsWith(
      rows(
        A.company,
        sql`INSERT INTO businesses (id, company_id, vertical_type, name_en)
        VALUES ('01920000-0000-7000-8000-0000000000a9', ${B.company}, 'salon', 'x')`,
      ),
      RLS,
    );
  });

  it("a branch INSERT with B's company and business is rejected — the pair satisfies the FK, not RLS", async () => {
    await rejectsWith(
      rows(
        A.company,
        sql`INSERT INTO branches (id, company_id, business_id, name_en)
            VALUES ('01920000-0000-7000-8000-0000000000a6', ${B.company}, ${B.business}, 'x')`,
      ),
      RLS,
    );
  });

  it("UPDATE of B's row as A affects 0 rows and leaves it unchanged", async () => {
    const updated = await rows(
      A.company,
      sql`UPDATE businesses SET name_en = 'hijacked' WHERE id = ${B.business} RETURNING id`,
    );
    expect(updated).toEqual([]);
    expect(await rows(B.company, sql`SELECT name_en FROM businesses`)).toEqual([
      { name_en: 'Business B' },
    ]);
  });

  it("DELETE of B's row as A affects 0 rows", async () => {
    expect(
      await rows(A.company, sql`DELETE FROM branches WHERE id = ${B.branch} RETURNING id`),
    ).toEqual([]);
    expect(await rows(B.company, sql`SELECT id FROM branches`)).toEqual([{ id: B.branch }]);
  });

  it('moving a same-tenant row to another company is rejected', async () => {
    const own = '01920000-0000-7000-8000-0000000000a8';
    await rows(
      A.company,
      sql`INSERT INTO businesses (id, company_id, vertical_type, name_en)
      VALUES (${own}, ${A.company}, 'retail', 'Own')`,
    );
    await rejectsWith(
      rows(A.company, sql`UPDATE businesses SET company_id = ${B.company} WHERE id = ${own}`),
      RLS,
    );
  });
});

describe('branch updates stay inside the tenant', () => {
  it('a same-tenant update succeeds, so a deny-all policy cannot pass this suite', async () => {
    const renamed = await rows(
      A.company,
      sql`UPDATE branches SET name_en = 'Branch A renamed' WHERE id = ${A.branch} RETURNING id`,
    );
    expect(renamed).toEqual([{ id: A.branch }]);
  });

  it("moving A's branch to B's company and business is rejected by WITH CHECK", async () => {
    await rejectsWith(
      rows(
        A.company,
        sql`UPDATE branches SET company_id = ${B.company}, business_id = ${B.business}
            WHERE id = ${A.branch}`,
      ),
      RLS,
    );
  });

  it("re-pointing A's branch at B's business is rejected by the tenant-qualified FK", async () => {
    await rejectsWith(
      rows(A.company, sql`UPDATE branches SET business_id = ${B.business} WHERE id = ${A.branch}`),
      /branches_business_fk/,
    );
  });
});

describe('referential integrity across tenants', () => {
  it("a branch cannot point at B's business — the tenant-qualified FK refuses it", async () => {
    await rejectsWith(
      rows(
        A.company,
        sql`INSERT INTO branches (id, company_id, business_id, name_en)
        VALUES ('01920000-0000-7000-8000-0000000000a7', ${A.company}, ${B.business}, 'x')`,
      ),
      /branches_business_fk/,
    );
  });
});

describe('companies — the tenant root, keyed on id', () => {
  it('A sees only its own company', async () => {
    expect(await rows(A.company, sql`SELECT id FROM companies`)).toEqual([{ id: A.company }]);
  });

  it('cannot insert a company whose id is not the current tenant', async () => {
    await rejectsWith(
      rows(
        A.company,
        sql`INSERT INTO companies (id, name_en, owner_user_id, plan_id)
        SELECT '01920000-0000-7000-8000-0000000000d0', 'x', ${USER}, id FROM plans LIMIT 1`,
      ),
      RLS,
    );
  });

  it("updating B's company as A affects 0 rows", async () => {
    expect(
      await rows(
        A.company,
        sql`UPDATE companies SET name_en = 'x' WHERE id = ${B.company} RETURNING id`,
      ),
    ).toEqual([]);
  });

  it('DELETE is not granted at all — permission denied, not 0 rows', async () => {
    await rejectsWith(
      rows(A.company, sql`DELETE FROM companies WHERE id = ${A.company}`),
      /permission denied/,
    );
  });
});

describe('companies — the write policies allow the legitimate path', () => {
  // A company with no children, so a foreign-key error can never stand in for the expected RLS rejection.
  const NEW = '01920000-0000-7000-8000-0000000000c0';

  it('withNewTenant creates the company, and its own context can rename it', async () => {
    const created = await db.withNewTenant(USER, async (tx, companyId) =>
      Array.from(
        await tx.execute(sql`INSERT INTO companies (id, name_en, owner_user_id, plan_id)
          SELECT ${companyId}, 'Created', ${USER}, id FROM plans LIMIT 1 RETURNING id`),
      ),
    );
    expect(created).toEqual([{ id: NEW }]);
    expect(
      await rows(
        NEW,
        sql`UPDATE companies SET name_en = 'Renamed' WHERE id = ${NEW} RETURNING name_en`,
      ),
    ).toEqual([{ name_en: 'Renamed' }]);
  });

  it("changing the company's own id is rejected by the UPDATE WITH CHECK", async () => {
    await rejectsWith(
      rows(
        NEW,
        sql`UPDATE companies SET id = '01920000-0000-7000-8000-0000000000c9' WHERE id = ${NEW}`,
      ),
      RLS,
    );
  });
});

describe('plans — global reference data', () => {
  it('is readable by the app role', async () => {
    expect(await rows(A.company, sql`SELECT code FROM plans`)).toEqual([{ code: 'provisional' }]);
  });

  it('is not writable by the app role', async () => {
    await rejectsWith(rows(A.company, sql`UPDATE plans SET name_en = 'x'`), /permission denied/);
  });
});

// Runs last: it leaves an A row that reuses B's business id.
describe('identifiers are scoped to the tenant (ADR-0007)', () => {
  it("inserting B's business id under A succeeds — no duplicate-key error reveals B's row", async () => {
    const created = await rows(
      A.company,
      sql`INSERT INTO businesses (id, company_id, vertical_type, name_en)
          VALUES (${B.business}, ${A.company}, 'salon', 'same id, other tenant')
          ON CONFLICT (company_id, id) DO UPDATE SET name_en = EXCLUDED.name_en
          RETURNING company_id`,
    );
    expect(created).toEqual([{ company_id: A.company }]);
    expect(await rows(B.company, sql`SELECT name_en FROM businesses`)).toEqual([
      { name_en: 'Business B' },
    ]);
  });

  it("inserting B's branch id under A succeeds and leaves B's branch untouched", async () => {
    const created = await rows(
      A.company,
      sql`INSERT INTO branches (id, company_id, business_id, name_en)
          VALUES (${B.branch}, ${A.company}, ${A.business}, 'same id, other tenant')
          RETURNING company_id`,
    );
    expect(created).toEqual([{ company_id: A.company }]);
    expect(await rows(B.company, sql`SELECT name_en FROM branches`)).toEqual([
      { name_en: 'Branch B' },
    ]);
  });
});
