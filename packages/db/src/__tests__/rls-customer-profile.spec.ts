import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expectPgError } from '../../test/rating-fixtures.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A } = TENANT;
const OPT_OUT_AT = '2026-10-01T00:00:00.000Z';
const PROFILE_EMPTY = { id: '01920000-0000-7000-8000-00000000c001', phone: '+12025550141' };
const PROFILE_FILLED = { id: '01920000-0000-7000-8000-00000000c002', phone: '+12025550142' };
let caseIndex = 100;
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => PROFILE_EMPTY.id } });
});

afterAll(async () => {
  await db.close();
  await owner.end();
  await testDb.drop();
});

const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));

// الصفان بيتزرعوا مرة واحدة، والصف المملوء بيتكتب مرة واحدة بس (الحراسة بترفض التانية).
const ensureProfileRows = async (): Promise<void> => {
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${A.company}, ${PROFILE_EMPTY.id}, 'Profile empty', ${PROFILE_EMPTY.phone}, 'ar', now(), now()),
           (${A.company}, ${PROFILE_FILLED.id}, 'Profile filled', ${PROFILE_FILLED.phone}, 'ar', now(), now())
    ON CONFLICT DO NOTHING`;
  await owner`UPDATE customers SET birth_month = 3, birth_day = 5, birth_year = 1990,
      gender = 'female', email = 'a@b.test'
    WHERE company_id = ${A.company} AND id = ${PROFILE_FILLED.id} AND birth_month IS NULL`;
};

describe('customers — the profile columns and their CHECKs', () => {
  it.each([
    ['customers_birth_month', sql`birth_month = 13`],
    ['customers_birth_day', sql`birth_day = 32`],
    ['customers_birth_year', sql`birth_month = 3, birth_day = 5, birth_year = 0`],
    ['customers_gender', sql`gender = 'ذكر'`],
    ['customers_email', sql`email = 'ab.test'`],
  ])('the database CHECK %s refuses its bad values', async (constraint, change) => {
    await ensureProfileRows();
    await expectPgError(
      asA(sql`UPDATE customers SET ${change}
        WHERE company_id = ${A.company} AND id = ${PROFILE_EMPTY.id}`),
      '23514',
      constraint,
    );
  });

  it.each([
    ['a day that does not exist in its month', sql`birth_month = 2, birth_day = 30`],
    ['a day that does not exist in a 30 day month', sql`birth_month = 4, birth_day = 31`],
    ['a day without its month', sql`birth_day = 5`],
    ['a year without its day and month', sql`birth_year = 1990`],
  ])('the birthday shape refuses %s', async (_case, change) => {
    await ensureProfileRows();
    await expectPgError(
      asA(sql`UPDATE customers SET ${change}
        WHERE company_id = ${A.company} AND id = ${PROFILE_EMPTY.id}`),
      '23514',
      'customers_birthday_shape',
    );
  });

  it.each([
    [
      'the 29th of February in a leap year',
      sql`birth_month = 2, birth_day = 29, birth_year = 2024`,
    ],
    ['the 29th of February without a year', sql`birth_month = 2, birth_day = 29`],
    ['a day and a month without a year', sql`birth_month = 3, birth_day = 5`],
  ])('the birthday shape accepts %s', async (_case, change) => {
    // كل حالة في صفها: الحراسة بتمنع الكتابة التانية على نفس الحقول.
    const index = caseIndex++;
    const id = `01920000-0000-7000-8000-00000000c${String(index).padStart(3, '0')}`;
    const phone = `+12025550${String(index).padStart(3, '0')}`;
    await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
      VALUES (${A.company}, ${id}, 'Shape', ${phone}, 'ar', now(), now())
      ON CONFLICT DO NOTHING`;
    const rows = await asA(sql`UPDATE customers SET ${change}
      WHERE company_id = ${A.company} AND id = ${id} RETURNING id`);
    expect(Array.from(rows)).toHaveLength(1);
  });

  it('refuses the 29th of February in a year that is not a leap year', async () => {
    await ensureProfileRows();
    await expectPgError(
      asA(sql`UPDATE customers SET birth_month = 2, birth_day = 29, birth_year = 1900
        WHERE company_id = ${A.company} AND id = ${PROFILE_EMPTY.id}`),
      '23514',
      'customers_birthday_shape',
    );
  });
});

describe('customers — the set-once profile guard', () => {
  it('a NULL profile column accepts its first value', async () => {
    await ensureProfileRows();
    const rows = await asA(sql`UPDATE customers SET email = 'a@b.test', gender = 'male'
      WHERE company_id = ${A.company} AND id = ${PROFILE_EMPTY.id} RETURNING email, gender`);
    expect(Array.from(rows)).toEqual([{ email: 'a@b.test', gender: 'male' }]);
  });

  it.each([
    ['gender', sql`gender = 'male'`],
    ['gender', sql`gender = NULL`],
    ['email', sql`email = 'c@d.test'`],
    ['email', sql`email = NULL`],
    ['birth_month', sql`birth_month = 4`],
    ['birth_month', sql`birth_month = NULL`],
    ['birth_day', sql`birth_day = 6`],
    ['birth_day', sql`birth_day = NULL`],
    ['birth_year', sql`birth_year = 1991`],
    ['birth_year', sql`birth_year = NULL`],
  ])('a written %s refuses to change and to be emptied', async (_column, change) => {
    await ensureProfileRows();
    await expectPgError(
      asA(sql`UPDATE customers SET ${change}
        WHERE company_id = ${A.company} AND id = ${PROFILE_FILLED.id}`),
      '23514',
      'customers_profile_set_once',
    );
  });

  it('the same value again passes the guard', async () => {
    await ensureProfileRows();
    const rows =
      await asA(sql`UPDATE customers SET birth_month = 3, birth_day = 5, birth_year = 1990,
        gender = 'female', email = 'a@b.test'
      WHERE company_id = ${A.company} AND id = ${PROFILE_FILLED.id} RETURNING gender, email`);
    expect(Array.from(rows)).toEqual([{ gender: 'female', email: 'a@b.test' }]);
  });

  it('the opt-out update still passes the profile guard', async () => {
    await ensureProfileRows();
    const rows = await asA(sql`UPDATE customers SET opted_out_at = ${OPT_OUT_AT}::timestamptz,
        updated_at = ${OPT_OUT_AT}::timestamptz
      WHERE company_id = ${A.company} AND id = ${PROFILE_FILLED.id} RETURNING opted_out_at`);
    expect(Array.from(rows)).toHaveLength(1);
  });
});

describe('customers — the guard under a concurrent fill and its ACL', () => {
  it('a NULL column filled with WHERE IS NULL keeps the first writer value', async () => {
    await ensureProfileRows();
    const id = '01920000-0000-7000-8000-00000000c010';
    await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
      VALUES (${A.company}, ${id}, 'Concurrent fill', '+12025550143', 'ar', now(), now())
      ON CONFLICT DO NOTHING`;
    const results = await Promise.all([
      asA(sql`UPDATE customers SET email = 'first@b.test'
        WHERE company_id = ${A.company} AND id = ${id} AND email IS NULL RETURNING email`),
      asA(sql`UPDATE customers SET email = 'second@b.test'
        WHERE company_id = ${A.company} AND id = ${id} AND email IS NULL RETURNING email`),
    ]);
    const changed = results.flatMap((rows) => Array.from(rows));
    expect(changed).toHaveLength(1);
    expect(['first@b.test', 'second@b.test']).toContain(changed[0]?.['email']);
    const rows = await asA(sql`SELECT email FROM customers
      WHERE company_id = ${A.company} AND id = ${id}`);
    expect(Array.from(rows)).toEqual(changed);
  });

  it('only the application role may execute the guard, and PUBLIC may not', async () => {
    const rows = await owner<
      { app: boolean; auth: boolean; dispatcher: boolean; notifications: boolean }[]
    >`
      SELECT has_function_privilege('pospay_app', p.oid, 'EXECUTE') AS app,
        has_function_privilege('pospay_auth', p.oid, 'EXECUTE') AS auth,
        has_function_privilege('pospay_dispatcher', p.oid, 'EXECUTE') AS dispatcher,
        has_function_privilege('pospay_notifications', p.oid, 'EXECUTE') AS notifications
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'customers_profile_guard'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.app).toBe(true);
    expect(rows[0]?.auth).toBe(false);
    expect(rows[0]?.dispatcher).toBe(false);
    expect(rows[0]?.notifications).toBe(false);
    const publicGrants = await owner<{ grantee: number }[]>`
      SELECT a.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'customers_profile_guard'
        AND a.grantee = 0::oid AND a.privilege_type = 'EXECUTE'`;
    expect(publicGrants).toEqual([]);
  });
});

describe('customers — the expanded schema stays backward compatible', () => {
  it('R-1 the old INSERT works as the application role and leaves the profile NULL', async () => {
    const rows =
      await asA(sql`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
      VALUES (${A.company}, ${'01920000-0000-7000-8000-00000000c0f1'}, 'Old insert', '+12025550151', 'ar', now(), now())
      RETURNING birth_month, birth_day, birth_year, gender, email`);
    expect(Array.from(rows)).toEqual([
      { birth_month: null, birth_day: null, birth_year: null, gender: null, email: null },
    ]);
  });

  it('R-3 the old opt-out update still works and the one-way guard still refuses', async () => {
    const id = '01920000-0000-7000-8000-00000000c0f2';
    await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
      VALUES (${A.company}, ${id}, 'Old opt out', '+12025550152', 'ar', now(), now())
      ON CONFLICT DO NOTHING`;
    const rows = await asA(sql`UPDATE customers SET opted_out_at = ${OPT_OUT_AT}::timestamptz,
        updated_at = ${OPT_OUT_AT}::timestamptz
      WHERE company_id = ${A.company} AND id = ${id} RETURNING opted_out_at`);
    expect(Array.from(rows)).toHaveLength(1);
    await expectPgError(
      asA(sql`UPDATE customers SET opted_out_at = NULL
        WHERE company_id = ${A.company} AND id = ${id}`),
      '23514',
      'customers_opt_out_one_way',
    );
  });

  it('R-4 the old column list reads a row written with every profile field', async () => {
    const rows = await owner`
      SELECT id, name, phone, locale, opted_out_at FROM customers
      WHERE company_id = ${A.company} AND id = ${PROFILE_FILLED.id}`;
    expect(rows).toHaveLength(1);
  });

  it('R-5 no INSERT trigger exists on customers, so an omitted gender is never refused', async () => {
    const rows = await owner<{ tgname: string; event: string }[]>`
      SELECT tgname, CASE WHEN tgtype & 4 = 4 THEN 'INSERT' ELSE 'UPDATE' END AS event
      FROM pg_trigger WHERE tgrelid = 'customers'::regclass AND NOT tgisinternal`;
    expect(rows.map((r) => r.tgname).sort()).toEqual([
      'customers_opt_out_guard',
      'customers_profile_guard',
    ]);
    expect(rows.some((r) => r.event === 'INSERT')).toBe(false);
  });
});

// حالة الكتالوج بعد ما الـ bootstrap يشغّل كل الهجرات بالترتيب: القيود الستة اتضافت
// NOT VALID في 0198 واتحقق منها في 0199، فلازم كل واحد فيهم convalidated. والفهرس اتبنى
// CONCURRENTLY في 0199، فلازم indisvalid و indisready اتنين true (مش بس موجود في الكتالوج).
describe('customers — the migration split left the constraints validated and the index usable', () => {
  it('all six profile CHECKs are convalidated after the canonical bootstrap', async () => {
    const rows = await owner<{ conname: string; convalidated: boolean }[]>`
      SELECT conname, convalidated FROM pg_constraint
      WHERE conrelid = 'customers'::regclass AND conname IN (
        'customers_birth_month', 'customers_birth_day', 'customers_birth_year',
        'customers_gender', 'customers_email', 'customers_birthday_shape')
      ORDER BY conname`;
    expect(rows).toEqual([
      { conname: 'customers_birth_day', convalidated: true },
      { conname: 'customers_birth_month', convalidated: true },
      { conname: 'customers_birth_year', convalidated: true },
      { conname: 'customers_birthday_shape', convalidated: true },
      { conname: 'customers_email', convalidated: true },
      { conname: 'customers_gender', convalidated: true },
    ]);
  });

  it('the notes business index is valid and ready on customer_notes', async () => {
    const rows = await owner<{ column_name: string; indisvalid: boolean; indisready: boolean }[]>`
      SELECT pg_get_indexdef(i.indexrelid, k + 1, true) AS column_name,
        i.indisvalid, i.indisready
      FROM pg_index i
      CROSS JOIN LATERAL generate_series(0, i.indnkeyatts - 1) AS g(k)
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'customer_notes_business_idx'
        AND i.indrelid = 'customer_notes'::regclass
      ORDER BY k`;
    expect(rows).toEqual([
      { column_name: 'company_id', indisvalid: true, indisready: true },
      { column_name: 'business_id', indisvalid: true, indisready: true },
    ]);
  });
});
