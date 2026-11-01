import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expectPgError } from '../../test/rating-fixtures.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const CUSTOMER_A = '01920000-0000-7000-8000-00000000d001';
const CUSTOMER_B = '01920000-0000-7000-8000-00000000d002';
const CUSTOMER_A_SECOND = '01920000-0000-7000-8000-00000000d003';
const SECOND_BUSINESS_A = '01920000-0000-7000-8000-00000000d0a1';
const SECOND_BRANCH_A = '01920000-0000-7000-8000-00000000d0a2';
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
    VALUES (${SECOND_BUSINESS_A}, ${A.company}, 'salon', 'Second business of A')`;
  await owner`INSERT INTO branches (id, company_id, business_id, name_en)
    VALUES (${SECOND_BRANCH_A}, ${A.company}, ${SECOND_BUSINESS_A}, 'Branch of the second business of A')`;
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${A.company}, ${CUSTOMER_A}, 'Customer A', '+12025550161', 'ar', now(), now()),
           (${A.company}, ${CUSTOMER_A_SECOND}, 'Customer A second', '+12025550162', 'ar', now(), now()),
           (${B.company}, ${CUSTOMER_B}, 'Customer B', '+12025550163', 'en', now(), now())`;
  // ملاحظة حقيقية لشركة تانية: من غيرها مش هنعرف إن العزل شغال ولا الجدول فاضي.
  await owner`INSERT INTO customer_notes (company_id, customer_id, business_id, note, created_at)
    VALUES (${B.company}, ${CUSTOMER_B}, ${B.business}, 'Note of the other company', now())`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => CUSTOMER_A } });
});

afterAll(async () => {
  await db.close();
  await owner.end();
  await testDb.drop();
});

const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));
const asB = (query: ReturnType<typeof sql>) => db.withTenant(B.company, (tx) => tx.execute(query));

const insertNote = (companyId: string, customerId: string, businessId: string, note: string) =>
  sql`INSERT INTO customer_notes (company_id, customer_id, business_id, note, created_at)
    VALUES (${companyId}, ${customerId}, ${businessId}, ${note}, now())`;

describe('customer_notes — forced tenant isolation and minimal grants', () => {
  it('enables and forces RLS; the application role owns no table and cannot bypass it', async () => {
    const [row] =
      await owner`SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'customer_notes'::regclass`;
    expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    expect(row?.['owner']).not.toBe('pospay_app');
    const [role] =
      await owner`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'pospay_app'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('A sees no note of B and cannot insert a note under B', async () => {
    const seenByB = await asB(
      sql`SELECT note FROM customer_notes WHERE customer_id = ${CUSTOMER_B}`,
    );
    expect(Array.from(seenByB)).toEqual([{ note: 'Note of the other company' }]);
    const seenByA = await asA(
      sql`SELECT note FROM customer_notes WHERE customer_id = ${CUSTOMER_B}`,
    );
    expect(Array.from(seenByA)).toEqual([]);
    await expectPgError(
      asA(insertNote(B.company, CUSTOMER_B, B.business, 'Foreign note')),
      '42501',
    );
  });

  it('a note of the same company is readable, whoever wrote it', async () => {
    await asA(insertNote(A.company, CUSTOMER_A, A.business, 'Note of the first business'));
    await asA(insertNote(A.company, CUSTOMER_A, SECOND_BUSINESS_A, 'Note of the second business'));
    const rows = await asA(sql`SELECT business_id, note FROM customer_notes ORDER BY business_id`);
    expect(Array.from(rows)).toEqual([
      { business_id: A.business, note: 'Note of the first business' },
      { business_id: SECOND_BUSINESS_A, note: 'Note of the second business' },
    ]);
  });

  it('updating and deleting a note are refused; the row is immutable', async () => {
    await expectPgError(
      asA(sql`UPDATE customer_notes SET note = 'Changed'
        WHERE company_id = ${A.company} AND customer_id = ${CUSTOMER_A}`),
      '42501',
    );
    await expectPgError(
      asA(
        sql`DELETE FROM customer_notes WHERE company_id = ${A.company} AND customer_id = ${CUSTOMER_A}`,
      ),
      '42501',
    );
  });
});

describe('customer_notes — the note row stays inside its company', () => {
  it('a note cannot point at a customer or a business of another company', async () => {
    await expectPgError(
      asA(insertNote(A.company, CUSTOMER_B, A.business, 'Foreign customer')),
      '23503',
    );
    await expectPgError(
      asA(insertNote(A.company, CUSTOMER_A, B.business, 'Foreign business')),
      '23503',
    );
  });
});

describe('customer_notes — the notes stay inside their company', () => {
  it('the notes stay invisible without a company context', async () => {
    const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      const rows = await app`SELECT note FROM customer_notes`;
      expect(Array.from(rows)).toEqual([]);
    } finally {
      await app.end();
    }
  });

  it('the other runtime roles can neither read nor write a note', async () => {
    const roles = await owner<{ role: string; can_read: boolean; can_write: boolean }[]>`
      SELECT r.rolname AS role,
        has_table_privilege(r.rolname, 'customer_notes', 'SELECT') AS can_read,
        has_table_privilege(r.rolname, 'customer_notes', 'INSERT') AS can_write
      FROM pg_roles r
      WHERE r.rolname IN ('pospay_auth', 'pospay_dispatcher', 'pospay_notifications')
      ORDER BY r.rolname`;
    expect(roles).toEqual([
      { role: 'pospay_auth', can_read: false, can_write: false },
      { role: 'pospay_dispatcher', can_read: false, can_write: false },
      { role: 'pospay_notifications', can_read: false, can_write: false },
    ]);
  });
});

describe('customer_notes — the note CHECK and the indexes', () => {
  it.each([
    ['an empty note', ''],
    ['a note over 500 characters', 'x'.repeat(501)],
    ['a note with outer spaces', ' padded '],
  ])('the database refuses %s', async (_case, note) => {
    await expectPgError(asA(insertNote(A.company, CUSTOMER_A_SECOND, A.business, note)), '23514');
  });

  it('a note of exactly 500 characters is stored', async () => {
    const rows =
      await asA(sql`INSERT INTO customer_notes (company_id, customer_id, business_id, note, created_at)
      VALUES (${A.company}, ${CUSTOMER_A_SECOND}, ${A.business}, ${'x'.repeat(500)}, now())
      RETURNING char_length(note) AS length`);
    expect(Array.from(rows)).toEqual([{ length: 500 }]);
  });

  it('the primary key covers the customer and the business index covers its foreign key', async () => {
    const indexes =
      await owner`SELECT indexdef FROM pg_indexes WHERE tablename = 'customer_notes' ORDER BY indexname`;
    const definitions = indexes.map((row) => String(row['indexdef']));
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('UNIQUE INDEX customer_notes_pkey'),
        expect.stringContaining('customer_notes_business_idx'),
        expect.stringContaining('(company_id, business_id)'),
      ]),
    );
  });
});
