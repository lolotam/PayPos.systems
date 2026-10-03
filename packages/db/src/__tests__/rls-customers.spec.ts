import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const ID = '01920000-0000-7000-8000-000000000abc';
const PHONE = '+12025550123';
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${B.company}, ${ID}, 'Sentinel B', ${PHONE}, 'en', now(), now())`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => ID } });
});

afterAll(async () => {
  await db.close();
  await owner.end();
  await testDb.drop();
});

const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));
const insert = (companyId: string, phone = PHONE) => sql`
  INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
  VALUES (${companyId}, ${ID}, 'Synthetic', ${phone}, 'ar', now(), now()) RETURNING id`;

async function rejectsWith(work: Promise<unknown>, expected: RegExp): Promise<void> {
  const error = await work.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(cause instanceof Error ? cause.message : (error as Error).message).toMatch(expected);
}

describe('customers — forced tenant isolation and minimal grants', () => {
  it('enables and forces RLS; app owns no table and cannot bypass it', async () => {
    const [row] =
      await owner`SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'customers'::regclass`;
    expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    expect(row?.['owner']).not.toBe('pospay_app');
    const [role] =
      await owner`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'pospay_app'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('A sees no B rows and cannot insert under B even with a fresh phone', async () => {
    expect(Array.from(await asA(sql`SELECT id FROM customers`))).toEqual([]);
    await rejectsWith(asA(insert(B.company, '+12025550124')), /row-level security/);
  });

  it('identical ids and phone in A and B are allowed without an existence oracle', async () => {
    expect(Array.from(await asA(insert(A.company)))).toEqual([{ id: ID }]);
    expect(Array.from(await asA(sql`SELECT name FROM customers WHERE id = ${ID}`))).toEqual([
      { name: 'Synthetic' },
    ]);
    expect(
      await owner`SELECT name FROM customers WHERE company_id = ${B.company} AND id = ${ID}`,
    ).toEqual([{ name: 'Sentinel B' }]);
    await rejectsWith(asA(insert(A.company)), /unique constraint/);
  });

  it('runtime cannot update, reassign or delete any customer', async () => {
    await rejectsWith(
      asA(sql`UPDATE customers SET company_id = ${B.company} WHERE id = ${ID}`),
      /permission denied/,
    );
    await rejectsWith(
      asA(sql`UPDATE customers SET name = 'Changed' WHERE company_id = ${B.company}`),
      /permission denied/,
    );
    await rejectsWith(
      asA(sql`DELETE FROM customers WHERE company_id = ${B.company}`),
      /permission denied/,
    );
  });
});

describe('customers — context, constraints and lookup index', () => {
  it('no tenant context returns no rows after A/B transaction reuse', async () => {
    await db.withTenant(B.company, (tx) => tx.execute(sql`SELECT id FROM customers`));
    expect(
      Array.from(await db.withUser(A.business, (tx) => tx.execute(sql`SELECT id FROM customers`))),
    ).toEqual([]);
  });

  it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
    'foreign runtime role %s has no access',
    async (url) => {
      const role = postgres(testDb[url], { max: 1, onnotice: () => undefined });
      try {
        await expect(role`SELECT id FROM customers`).rejects.toThrow(/permission denied/);
      } finally {
        await role.end();
      }
    },
  );

  it('database CHECK refuses malformed phone and locale', async () => {
    for (const phone of ['2025550123', '+12025550123\n', '+012345']) {
      await rejectsWith(asA(insert(A.company, phone)), /customers_phone_e164/);
    }
    await rejectsWith(
      asA(sql`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
      VALUES (${A.company}, ${A.business}, 'Synthetic', '+12025550124', 'fr', now(), now())`),
      /customers_locale/,
    );
  });

  it('the creating migration has a leading company/phone index for the lookup and RLS predicate', async () => {
    const indexes =
      await owner`SELECT indexdef FROM pg_indexes WHERE tablename = 'customers' ORDER BY indexname`;
    expect(indexes.map((r) => r['indexdef'])).toEqual(
      expect.arrayContaining([
        expect.stringContaining('UNIQUE INDEX customers_company_phone_unique'),
        expect.stringContaining('(company_id, id)'),
      ]),
    );
    const plan = await db.withTenant(A.company, async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) SELECT id, name, phone, locale, opted_out_at
        FROM customers WHERE company_id = ${A.company} AND phone = ${PHONE}`);
    });
    expect(JSON.stringify(plan)).toContain('customers_company_phone_unique');
  });
});
