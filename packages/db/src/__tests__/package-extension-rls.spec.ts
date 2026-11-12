import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../test/orders-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const PACKAGE_TYPE = '01920000-0000-7000-8000-00000000f401';
const CURRENT = '2026-12-30';
const NEXT = '2027-01-31';

type Tenant = (typeof TENANT)[keyof typeof TENANT];
let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let serial = 0;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  for (const tenant of [A, B]) {
    await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
      VALUES (${tenant.company},${PACKAGE_TYPE},${tenant.business},'Synthetic package',1.000,30)`;
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => nextId() } });
  await extend(A);
  await extend(B);
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function nextId(): string {
  serial += 1;
  return `01920000-0000-7000-8000-${serial.toString(16).padStart(12, '0')}`;
}

type Failure = { code?: string; constraint_name?: string; cause?: Failure };

async function rejected(work: Promise<unknown>, code: string, constraint?: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  const failure = error as Failure;
  const actual = failure?.code ?? failure?.cause?.code;
  const name = failure?.constraint_name ?? failure?.cause?.constraint_name;
  expect(error).toBeInstanceOf(Error);
  if (constraint === undefined) expect(actual).toBe(code);
  else expect([actual, name]).toEqual([code, constraint]);
}

const asTenant = (company: string, query: SQL) =>
  db.withTenant(company, (tx) => tx.execute(query), { userId: USER });

function extensionInsert(tenant: Tenant, entitlement: string, reason = 'Synthetic extension'): SQL {
  return sql`INSERT INTO package_extensions
    (company_id,id,business_id,entitlement_id,branch_id,previous_expires_on,new_expires_on,reason,
      extended_by,extended_by_membership_id,extended_at)
    VALUES (${tenant.company},${nextId()},${tenant.business},${entitlement},${tenant.branch},${CURRENT},${NEXT},
      ${reason},${USER},${ORDER_IDS.membership},now())`;
}

async function seedSale(tenant: Tenant): Promise<string> {
  const entitlement = nextId();
  const component = nextId();
  await db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
        price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
        sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on)
      VALUES (${tenant.company},${entitlement},${tenant.business},${ORDER_IDS.customer},${PACKAGE_TYPE},'SOLD',
        'Synthetic package',30,1.000,1.000,0.000,0,'CASH',${ORDER_IDS.employee},${tenant.branch},
        '2026-10-01T08:00:00Z'::timestamptz,'2026-10-01','Asia/Kuwait',${USER},${ORDER_IDS.membership},${CURRENT})`);
    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
      VALUES (${tenant.company},${component},${tenant.business},${entitlement},${ORDER_IDS.service},1,'Synthetic',1.000,1,1.000)`);
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES (${tenant.company},${nextId()},${tenant.business},${entitlement},${component},1,1.000,'FREE')`);
  });
  return entitlement;
}

async function extend(tenant: Tenant, reason?: string): Promise<string> {
  const entitlement = await seedSale(tenant);
  await db.withTenant(tenant.company, async (tx) => {
    await tx.execute(extensionInsert(tenant, entitlement, reason));
    await tx.execute(sql`UPDATE package_entitlements SET expires_on=${NEXT} WHERE id=${entitlement}`);
  });
  return entitlement;
}

it.each(['', ' \t\r\n ', 'x'.repeat(501), '😀'.repeat(501)])(
  'refuses an invalid extension reason with %s characters',
  async (reason) => {
    const entitlement = await seedSale(A);
    await rejected(
      asTenant(A.company, extensionInsert(A, entitlement, reason)),
      '23514',
      'package_extensions_reason_check',
    );
  },
);

it('accepts 500 astral code points in the stored reason', async () => {
  const reason = '😀'.repeat(500);
  const entitlement = await extend(A, reason);
  expect(await owner`SELECT reason,char_length(reason) AS length FROM package_extensions
    WHERE entitlement_id=${entitlement}`).toEqual([{ reason, length: 500 }]);
});

it('refuses an extension whose new date is not later', async () => {
  const entitlement = await seedSale(A);
  await rejected(
    asTenant(
      A.company,
      sql`INSERT INTO package_extensions
        (company_id,id,business_id,entitlement_id,branch_id,previous_expires_on,new_expires_on,reason,
          extended_by,extended_by_membership_id)
        VALUES (${A.company},${nextId()},${A.business},${entitlement},${A.branch},${CURRENT},${CURRENT},
          'Not forward',${USER},${ORDER_IDS.membership})`,
    ),
    '23514',
    'package_extensions_forward_check',
  );
});

it('does not grant UPDATE or DELETE on extension history', async () => {
  await rejected(asTenant(A.company, sql`UPDATE package_extensions SET reason='Changed'`), '42501');
  await rejected(asTenant(A.company, sql`DELETE FROM package_extensions`), '42501');
});

it('forces RLS and hides tenant A extension rows from tenant B and from no context', async () => {
  expect(await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='package_extensions'`)
    .toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  expect(
    Array.from(await asTenant(B.company, sql`SELECT company_id FROM package_extensions WHERE company_id=${A.company}`)),
  ).toEqual([]);
  const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await app.unsafe('SELECT company_id FROM package_extensions')).toEqual([]);
  } finally {
    await app.end();
  }
});

it('refuses tenant B inserting extension history with tenant A company_id', async () => {
  const entitlement = await seedSale(A);
  await rejected(asTenant(B.company, extensionInsert(A, entitlement)), '42501');
});
