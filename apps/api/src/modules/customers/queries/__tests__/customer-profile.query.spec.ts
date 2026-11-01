import { customerProfile } from '@pospay/contracts';
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
import {
  customerProfileQuery,
  CustomerProfileReadError,
  readCustomerProfile,
  type CustomerProfileBusinessNames,
  type CustomerProfileContext,
} from '../customer-profile.query.ts';

// CLAUDE.md §9: نتيجة مقروءة + EXPLAIN ANALYZE على بيانات بالحجم الحقيقي.
const { A, B } = TENANT;
const CUSTOMER = '01920000-0000-7000-8000-00000000f001';
const SECOND_BUSINESS = '01920000-0000-7000-8000-00000000f002';
const ONE_NOTE_CUSTOMER = '01920000-0000-7000-8000-00000000f006';
const PLAIN_CUSTOMER = '01920000-0000-7000-8000-00000000f003';
const SHORT_CUSTOMER = '01920000-0000-7000-8000-00000000f004';
const FOREIGN_CUSTOMER = '01920000-0000-7000-8000-00000000f007';
const MISSING_CUSTOMER = '01920000-0000-7000-8000-00000000f005';

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

/** بيعدّ statements عشان نثبت إن عدد القراءات ثابت مهما زاد عدد الملاحظات. */
function counting(database: Database): { wrappers: TenantWrappers; calls: () => number } {
  let count = 0;
  const counted = (tx: Tx): Tx =>
    new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              count += 1;
              return target.execute(query);
            }
          : Reflect.get(target, property, receiver),
    });
  return {
    wrappers: {
      withUser: (userId, fn) => database.withUser(userId, (tx) => fn(counted(tx))),
      withNewTenant: (userId, fn) =>
        database.withNewTenant(userId, (tx, id) => fn(counted(tx), id)),
      withMember: (userId, companyId, fn) =>
        database.withMember(userId, companyId, (tx) => fn(counted(tx))),
      withTenant: (companyId, fn, options) =>
        database.withTenant(companyId, (tx) => fn(counted(tx)), options),
    },
    calls: () => count,
  };
}

async function seedBulkVolume(owner: postgres.Sql): Promise<void> {
  // Volume حقيقي: 20 شركة × 20 نشاط × 15 عميل، ولكل عميل ملاحظة؛ القراءة المفهرسة لازم تفوز على الـ scan.
  await owner`
    INSERT INTO companies (id, name_en, owner_user_id, plan_id)
    SELECT gen_random_uuid(), 'Bulk ' || n, ${USER}, (SELECT id FROM plans LIMIT 1)
    FROM generate_series(1, 20) AS n`;
  await owner`
    INSERT INTO businesses (id, company_id, vertical_type, name_en)
    SELECT gen_random_uuid(), c.id, 'retail', 'B' || n
    FROM companies c CROSS JOIN generate_series(1, 20) AS n`;
  await owner`
    INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    SELECT company_id, gen_random_uuid(), 'C' || n, '+1' || lpad(row_number() OVER ()::text, 11, '0'), 'ar', now(), now()
    FROM businesses CROSS JOIN generate_series(1, 15) AS n`;
  await owner`
    INSERT INTO customer_notes (company_id, customer_id, business_id, note, created_at)
    SELECT c.company_id, c.id,
      (SELECT b.id FROM businesses b WHERE b.company_id = c.company_id ORDER BY b.id LIMIT 1),
      'Bulk note', now()
    FROM customers c`;
  await owner`ANALYZE customers`;
  await owner`ANALYZE customer_notes`;
}

async function seedProfileRows(owner: postgres.Sql): Promise<void> {
  await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
    VALUES (${SECOND_BUSINESS}, ${A.company}, 'salon', 'Second business of A')`;
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, birth_month, birth_day, birth_year, gender, email, created_at, updated_at)
    VALUES (${A.company}, ${CUSTOMER}, 'Profile', '+12025550131', 'ar', 3, 5, 1990, 'female', 'profile@example.test', now(), now())`;
  await owner`INSERT INTO customer_notes (company_id, customer_id, business_id, note, created_at)
    VALUES (${A.company}, ${CUSTOMER}, ${A.business}, 'First note', now()),
           (${A.company}, ${CUSTOMER}, ${SECOND_BUSINESS}, 'Second note', now() + interval '1 minute')`;
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${A.company}, ${ONE_NOTE_CUSTOMER}, 'One note', '+12025550132', 'ar', now(), now()),
           (${A.company}, ${PLAIN_CUSTOMER}, 'Plain', '+12456', 'ar', now(), now()),
           (${A.company}, ${SHORT_CUSTOMER}, 'Short', '+12', 'ar', now(), now()),
           (${B.company}, ${FOREIGN_CUSTOMER}, 'Foreign', '+12025550133', 'ar', now(), now())`;
  await owner`INSERT INTO customer_notes (company_id, customer_id, business_id, note, created_at)
    VALUES (${A.company}, ${ONE_NOTE_CUSTOMER}, ${A.business}, 'Only note', now())`;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO "user"(id,name,email) VALUES(${USER},'Synthetic operator','operator@example.test')
      ON CONFLICT (id) DO NOTHING`;
    await seedBulkVolume(owner);
    await seedProfileRows(owner);
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('customer-profile.query — the profile rows', () => {
  it('reads the customer with the masked phone, the profile fields and the notes in order', async () => {
    const read = await db.withTenant(A.company, (tx) =>
      customerProfileQuery(tx, A.company, CUSTOMER),
    );
    expect(read?.customer).toEqual({
      id: CUSTOMER,
      name: 'Profile',
      locale: 'ar',
      opted_out: false,
      phone: '***131',
      birthday: { day: 5, month: 3, year: 1990 },
      gender: 'female',
      email: 'profile@example.test',
    });
    expect(read?.notes.map((note) => [note.business_id, note.note])).toEqual([
      [A.business, 'First note'],
      [SECOND_BUSINESS, 'Second note'],
    ]);
  });

  it('the minimum phone masks to the last two digits, like the domain does', async () => {
    const read = await db.withTenant(A.company, (tx) =>
      customerProfileQuery(tx, A.company, SHORT_CUSTOMER),
    );
    expect(read?.customer.phone).toBe('***12');
  });

  it('a customer without a profile reads the NULL fields', async () => {
    const read = await db.withTenant(A.company, (tx) =>
      customerProfileQuery(tx, A.company, PLAIN_CUSTOMER),
    );
    expect(read?.customer.birthday).toBeNull();
    expect(read?.customer.gender).toBeNull();
    expect(read?.customer.email).toBeNull();
    expect(read?.notes).toEqual([]);
  });

  it("another company's customer is not found", async () => {
    const read = await db.withTenant(A.company, (tx) =>
      customerProfileQuery(tx, A.company, FOREIGN_CUSTOMER),
    );
    expect(read).toBeNull();
  });

  it('an unknown customer id is not found', async () => {
    const read = await db.withTenant(A.company, (tx) =>
      customerProfileQuery(tx, A.company, MISSING_CUSTOMER),
    );
    expect(read).toBeNull();
  });
});

describe('customer-profile.query — the read boundary', () => {
  it('the note time is a UTC string, like the published contract wants', async () => {
    const read = await db.withTenant(A.company, (tx) =>
      customerProfileQuery(tx, A.company, CUSTOMER),
    );
    expect(read?.notes[0]?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('the response matches the published profile contract', async () => {
    const read = await db.withTenant(A.company, (tx) =>
      customerProfileQuery(tx, A.company, CUSTOMER),
    );
    expect(
      customerProfile.safeParse({
        id: read?.customer.id,
        name: read?.customer.name,
        locale: read?.customer.locale,
        opted_out: read?.customer.opted_out,
        phone: read?.customer.phone,
        birthday: read?.customer.birthday,
        gender: read?.customer.gender,
        email: read?.customer.email,
        notes: (read?.notes ?? []).map((note) => ({
          business_id: note.business_id,
          business_name_ar: null,
          business_name_en: 'Business',
          note: note.note,
          created_at: note.created_at,
        })),
      }).success,
    ).toBe(true);
  });

  it('a driver failure inside the names read is sanitized without cause or params', async () => {
    const leaking: CustomerProfileContext = async () => {
      throw new Error('relation "customer_notes" does not exist');
    };
    const failure = await db
      .withTenant(A.company, (tx) => readCustomerProfile(tx, A.company, CUSTOMER, leaking))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CustomerProfileReadError);
    expect(failure).toMatchObject({ message: 'CUSTOMER_PROFILE_READ_FAILED' });
    expect(failure).not.toHaveProperty('cause');
    expect(failure).not.toHaveProperty('params');
  });

  it('a missing business name is refused instead of an empty name', async () => {
    const empty: CustomerProfileContext = async () =>
      new Map<string, CustomerProfileBusinessNames>();
    const failure = await db
      .withTenant(A.company, (tx) => readCustomerProfile(tx, A.company, CUSTOMER, empty))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CustomerProfileReadError);
  });
});

describe('customer-profile.query — the read cost', () => {
  it('the statement count does not grow with the number of notes', async () => {
    const counter = counting(db);
    let nameCalls = 0;
    const names: CustomerProfileContext = async () => {
      nameCalls += 1;
      return new Map([
        [A.business, { name_ar: null, name_en: 'Business' }],
        [SECOND_BUSINESS, { name_ar: null, name_en: 'Second business' }],
      ]);
    };
    await counter.wrappers.withTenant(A.company, (tx) =>
      readCustomerProfile(tx, A.company, ONE_NOTE_CUSTOMER, names),
    );
    const oneNote = counter.calls();
    expect(nameCalls).toBe(1);
    await counter.wrappers.withTenant(A.company, (tx) =>
      readCustomerProfile(tx, A.company, CUSTOMER, names),
    );
    expect(counter.calls() - oneNote).toBe(oneNote);
    expect(nameCalls).toBe(2);
  });
});

describe('customer-profile.query — the query plan', () => {
  it('EXPLAIN ANALYZE: the customer and its notes come from the primary keys', async () => {
    plans.length = 0;
    await explaining(db).withTenant(A.company, (tx) =>
      customerProfileQuery(tx, A.company, CUSTOMER),
    );
    const customerPlan = plans[0] ?? '';
    const notesPlan = plans[1] ?? '';
    expect(customerPlan).toContain('customers_pkey');
    expect(customerPlan).not.toContain('Seq Scan');
    expect(notesPlan).toContain('customer_notes_pkey');
    expect(notesPlan).not.toContain('Seq Scan');
  });
});
