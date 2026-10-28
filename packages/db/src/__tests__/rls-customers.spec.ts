import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expectPgError } from '../../test/rating-fixtures.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const ID = '01920000-0000-7000-8000-000000000abc';
const PHONE = '+12025550123';
// كل حالة من اختبار الرفض ليها صفها: الرفض اتجاه واحد، فما ينفعش نرجّع صف مرفوض لنفسه.
const FIRST_OPT_OUT = { id: '01920000-0000-7000-8000-000000000ac1', phone: '+12025550131' };
const SAME_OPT_OUT = { id: '01920000-0000-7000-8000-000000000ac2', phone: '+12025550132' };
const RESTORED_OPT_OUT = { id: '01920000-0000-7000-8000-000000000ac3', phone: '+12025550133' };
const REPLACED_OPT_OUT = { id: '01920000-0000-7000-8000-000000000ac4', phone: '+12025550134' };
const STAMPED_OPT_OUT = { id: '01920000-0000-7000-8000-000000000ac5', phone: '+12025550135' };
const OTHER_TENANT = { id: '01920000-0000-7000-8000-000000000ac6', phone: '+12025550136' };
const NO_CONTEXT_OPT_OUT = { id: '01920000-0000-7000-8000-000000000ac7', phone: '+12025550137' };
const OWNER_RESTORED_OPT_OUT = {
  id: '01920000-0000-7000-8000-000000000ac8',
  phone: '+12025550138',
};
const OWNER_REPLACED_OPT_OUT = {
  id: '01920000-0000-7000-8000-000000000ac9',
  phone: '+12025550139',
};
const OPT_OUT_AT = '2026-10-01T00:00:00.000Z';
const OTHER_OPT_OUT_AT = '2026-10-02T00:00:00.000Z';
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

// الصفوف بتتزرع مرة واحدة وبتتخطى تاني، فكل اختبار يبقى مستقل عن اللي قبله.
const ensureOptOutRows = async (): Promise<void> => {
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${A.company}, ${FIRST_OPT_OUT.id}, 'First opt out', ${FIRST_OPT_OUT.phone}, 'ar', now(), now()),
           (${A.company}, ${SAME_OPT_OUT.id}, 'Same opt out', ${SAME_OPT_OUT.phone}, 'ar', now(), now()),
           (${A.company}, ${RESTORED_OPT_OUT.id}, 'Restored opt out', ${RESTORED_OPT_OUT.phone}, 'ar', now(), now()),
           (${A.company}, ${REPLACED_OPT_OUT.id}, 'Replaced opt out', ${REPLACED_OPT_OUT.phone}, 'ar', now(), now()),
           (${A.company}, ${STAMPED_OPT_OUT.id}, 'Stamped opt out', ${STAMPED_OPT_OUT.phone}, 'ar', now(), now()),
           (${A.company}, ${NO_CONTEXT_OPT_OUT.id}, 'No context opt out', ${NO_CONTEXT_OPT_OUT.phone}, 'ar', now(), now()),
           (${A.company}, ${OWNER_RESTORED_OPT_OUT.id}, 'Owner restored opt out', ${OWNER_RESTORED_OPT_OUT.phone}, 'ar', now(), now()),
           (${A.company}, ${OWNER_REPLACED_OPT_OUT.id}, 'Owner replaced opt out', ${OWNER_REPLACED_OPT_OUT.phone}, 'ar', now(), now()),
           (${B.company}, ${OTHER_TENANT.id}, 'Other tenant opt out', ${OTHER_TENANT.phone}, 'en', now(), now())
    ON CONFLICT DO NOTHING`;
};

const optOut = (id: string, at: string) =>
  asA(sql`UPDATE customers SET opted_out_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
    WHERE company_id = ${A.company} AND id = ${id} RETURNING opted_out_at`);

const readOptOut = (companyId: string, id: string) =>
  owner<{ opted_out_at: unknown }[]>`
    SELECT opted_out_at FROM customers WHERE company_id = ${companyId} AND id = ${id}`;

const isoOf = (value: unknown): string => new Date(String(value)).toISOString();

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

  it('runtime updates only the opt-out columns; reassigning and deleting stay forbidden', async () => {
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

describe('customers — the granted opt-out columns', () => {
  it('grants UPDATE only on opted_out_at and updated_at', async () => {
    const rows = await owner<{ attname: string; allowed: boolean }[]>`
      SELECT a.attname, has_column_privilege('pospay_app', 'customers'::regclass, a.attname, 'UPDATE') AS allowed
      FROM pg_attribute a
      WHERE a.attrelid = 'customers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attname`;
    expect(rows.filter((row) => row.allowed).map((row) => row.attname)).toEqual([
      'opted_out_at',
      'updated_at',
    ]);
    expect(rows.filter((row) => !row.allowed).map((row) => row.attname)).toEqual([
      'company_id',
      'created_at',
      'id',
      'locale',
      'name',
      'phone',
    ]);
  });

  it('the update policy reads the tenant on both sides', async () => {
    const [policy] = await owner<{ cmd: string; qual: string | null; with_check: string | null }[]>`
      SELECT cmd, qual, with_check FROM pg_policies
      WHERE tablename = 'customers' AND policyname = 'customers_update'`;
    expect(policy?.cmd).toBe('UPDATE');
    expect(policy?.qual).toContain('app_company_id()');
    expect(policy?.with_check).toContain('app_company_id()');
  });

  it('the first opt-out writes the instant and leaves every other column untouched', async () => {
    await ensureOptOutRows();
    const before =
      await owner`SELECT * FROM customers WHERE company_id = ${A.company} AND id = ${FIRST_OPT_OUT.id}`;
    const rows = await optOut(FIRST_OPT_OUT.id, OPT_OUT_AT);
    expect(Array.from(rows)).toHaveLength(1);
    const after =
      await owner`SELECT * FROM customers WHERE company_id = ${A.company} AND id = ${FIRST_OPT_OUT.id}`;
    expect(after[0]).toMatchObject({
      id: FIRST_OPT_OUT.id,
      company_id: A.company,
      name: before[0]?.['name'],
      phone: before[0]?.['phone'],
      locale: before[0]?.['locale'],
    });
    expect(isoOf(after[0]?.['opted_out_at'])).toBe(OPT_OUT_AT);
    expect(isoOf(after[0]?.['created_at'])).toBe(isoOf(before[0]?.['created_at']));
  });

  it('writing the same instant again keeps the first one', async () => {
    await ensureOptOutRows();
    await optOut(SAME_OPT_OUT.id, OPT_OUT_AT);
    const rows = await optOut(SAME_OPT_OUT.id, OPT_OUT_AT);
    expect(Array.from(rows)).toHaveLength(1);
    const after = await readOptOut(A.company, SAME_OPT_OUT.id);
    expect(isoOf(after[0]?.opted_out_at)).toBe(OPT_OUT_AT);
  });
});

describe('customers — the one-way opt-out guard', () => {
  it.each([
    ['restore', RESTORED_OPT_OUT, null],
    ['replace', REPLACED_OPT_OUT, OTHER_OPT_OUT_AT],
  ] as const)(
    'refuses to %s the opt-out and keeps the first instant',
    async (_action, row, target) => {
      await ensureOptOutRows();
      await optOut(row.id, OPT_OUT_AT);
      await expectPgError(
        asA(sql`UPDATE customers SET opted_out_at = ${target}::timestamptz
          WHERE company_id = ${A.company} AND id = ${row.id}`),
        '23514',
        'customers_opt_out_one_way',
      );
      const after = await readOptOut(A.company, row.id);
      expect(isoOf(after[0]?.opted_out_at)).toBe(OPT_OUT_AT);
    },
  );

  it('updates updated_at alone on an opted-out row', async () => {
    await ensureOptOutRows();
    await optOut(STAMPED_OPT_OUT.id, OPT_OUT_AT);
    const rows = await asA(sql`UPDATE customers SET updated_at = ${OTHER_OPT_OUT_AT}::timestamptz
      WHERE company_id = ${A.company} AND id = ${STAMPED_OPT_OUT.id} RETURNING opted_out_at`);
    expect(Array.from(rows)).toHaveLength(1);
    expect(isoOf(rows[0]?.['opted_out_at'])).toBe(OPT_OUT_AT);
  });

  it('the owner connection cannot restore or replace the opt-out either', async () => {
    await ensureOptOutRows();
    await owner`UPDATE customers SET opted_out_at = ${OPT_OUT_AT}::timestamptz
      WHERE company_id = ${A.company} AND id = ${OWNER_RESTORED_OPT_OUT.id}`;
    await owner`UPDATE customers SET opted_out_at = ${OPT_OUT_AT}::timestamptz
      WHERE company_id = ${A.company} AND id = ${OWNER_REPLACED_OPT_OUT.id}`;
    await expectPgError(
      owner`UPDATE customers SET opted_out_at = NULL
        WHERE company_id = ${A.company} AND id = ${OWNER_RESTORED_OPT_OUT.id}`,
      '23514',
      'customers_opt_out_one_way',
    );
    await expectPgError(
      owner`UPDATE customers SET opted_out_at = ${OTHER_OPT_OUT_AT}::timestamptz
        WHERE company_id = ${A.company} AND id = ${OWNER_REPLACED_OPT_OUT.id}`,
      '23514',
      'customers_opt_out_one_way',
    );
    const restored = await readOptOut(A.company, OWNER_RESTORED_OPT_OUT.id);
    expect(isoOf(restored[0]?.opted_out_at)).toBe(OPT_OUT_AT);
    const replaced = await readOptOut(A.company, OWNER_REPLACED_OPT_OUT.id);
    expect(isoOf(replaced[0]?.opted_out_at)).toBe(OPT_OUT_AT);
  });
});

describe('customers — what the runtime still cannot do', () => {
  it('a cross-tenant opt-out affects no row', async () => {
    await ensureOptOutRows();
    const rows = await asA(sql`UPDATE customers SET opted_out_at = ${OPT_OUT_AT}::timestamptz
      WHERE id = ${OTHER_TENANT.id}`);
    expect(Array.from(rows)).toEqual([]);
    const after = await readOptOut(B.company, OTHER_TENANT.id);
    expect(after[0]?.opted_out_at).toBeNull();
  });

  it('re-homing a customer is refused', async () => {
    await ensureOptOutRows();
    await expectPgError(
      asA(sql`UPDATE customers SET company_id = ${B.company}
        WHERE company_id = ${A.company} AND id = ${FIRST_OPT_OUT.id}`),
      '42501',
    );
  });

  const DENIED_COLUMNS: readonly (readonly [string, SQL])[] = [
    ['name', sql`name = 'Changed'`],
    ['phone', sql`phone = '+12025550199'`],
    ['locale', sql`locale = 'en'`],
    ['created_at', sql`created_at = now()`],
  ];

  it.each(DENIED_COLUMNS)('writing %s is refused', async (_column, change) => {
    await ensureOptOutRows();
    await expectPgError(
      asA(sql`UPDATE customers SET ${change}
        WHERE company_id = ${A.company} AND id = ${FIRST_OPT_OUT.id}`),
      '42501',
    );
  });

  it('deleting a customer is refused', async () => {
    await ensureOptOutRows();
    await expectPgError(
      asA(sql`DELETE FROM customers WHERE company_id = ${A.company} AND id = ${FIRST_OPT_OUT.id}`),
      '42501',
    );
  });

  it('without a tenant context the update affects no row', async () => {
    await ensureOptOutRows();
    const rows = await db.withUser(USER, (tx) =>
      tx.execute(sql`UPDATE customers SET opted_out_at = ${OPT_OUT_AT}::timestamptz
        WHERE id = ${NO_CONTEXT_OPT_OUT.id} RETURNING id`),
    );
    expect(Array.from(rows)).toEqual([]);
    const after = await readOptOut(A.company, NO_CONTEXT_OPT_OUT.id);
    expect(after[0]?.opted_out_at).toBeNull();
  });
});

describe('customers — the row lock and the guard ACL', () => {
  it('locks the customer row for update and for no-key update', async () => {
    await ensureOptOutRows();
    const locked = await asA(sql`SELECT id FROM customers
      WHERE company_id = ${A.company} AND id = ${FIRST_OPT_OUT.id} FOR UPDATE`);
    expect(Array.from(locked)).toEqual([{ id: FIRST_OPT_OUT.id }]);
    const noKey = await asA(sql`SELECT id FROM customers
      WHERE company_id = ${A.company} AND id = ${FIRST_OPT_OUT.id} FOR NO KEY UPDATE`);
    expect(Array.from(noKey)).toEqual([{ id: FIRST_OPT_OUT.id }]);
  });

  it('cannot lock another tenant row', async () => {
    await ensureOptOutRows();
    const locked = await asA(
      sql`SELECT id FROM customers WHERE id = ${OTHER_TENANT.id} FOR UPDATE`,
    );
    expect(Array.from(locked)).toEqual([]);
  });

  it('only the application role may execute the guard', async () => {
    const rows = await owner<
      { app: boolean; auth: boolean; dispatcher: boolean; notifications: boolean }[]
    >`
      SELECT has_function_privilege('pospay_app', p.oid, 'EXECUTE') AS app,
        has_function_privilege('pospay_auth', p.oid, 'EXECUTE') AS auth,
        has_function_privilege('pospay_dispatcher', p.oid, 'EXECUTE') AS dispatcher,
        has_function_privilege('pospay_notifications', p.oid, 'EXECUTE') AS notifications
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'customers_opt_out_guard'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.app).toBe(true);
    expect(rows[0]?.auth).toBe(false);
    expect(rows[0]?.dispatcher).toBe(false);
    expect(rows[0]?.notifications).toBe(false);
  });

  it('PUBLIC cannot execute the guard', async () => {
    const rows = await owner<{ grantee: number }[]>`
      SELECT a.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'customers_opt_out_guard'
        AND a.grantee = 0::oid AND a.privilege_type = 'EXECUTE'`;
    expect(rows).toEqual([]);
  });
});
