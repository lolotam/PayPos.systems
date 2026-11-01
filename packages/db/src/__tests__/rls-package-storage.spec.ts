import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../test/orders-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const TABLES = ['package_entitlements', 'package_components', 'package_session_slots'] as const;

// نفس المعرفات في الشركتين: العزل هو اللي يفرق، مش التطابق.
const IDS = {
  entitlement: '01920000-0000-7000-8000-00000000e101',
  component: '01920000-0000-7000-8000-00000000e102',
  packageType: '01920000-0000-7000-8000-00000000e104',
};

const SLOT_IDS = [
  '01920000-0000-7000-8000-00000000e103',
  '01920000-0000-7000-8000-00000000e105',
  '01920000-0000-7000-8000-00000000e106',
];

const slotId = (ordinal: number): string =>
  SLOT_IDS[ordinal - 1] ?? SLOT_IDS[0] ?? '01920000-0000-7000-8000-00000000e103';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  for (const tenant of [A, B]) {
    await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
      VALUES (${tenant.company},${IDS.packageType},${tenant.business},'Synthetic package',30.000,30)`;
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => IDS.entitlement } });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

type Tenant = { company: string; business: string; branch: string };

const entitlementSql = (tenant: Tenant) => sql`
  INSERT INTO package_entitlements
    (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
     price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
     sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on)
  VALUES (${tenant.company},${IDS.entitlement},${tenant.business},${ORDER_IDS.customer},${IDS.packageType},
    'SOLD','Synthetic package',30,30.000,30.000,0.000,0,'CASH',${ORDER_IDS.employee},${tenant.branch},
    now(),current_date,'Asia/Kuwait',${USER},${ORDER_IDS.membership},current_date + 30)`;

const componentSql = (tenant: Tenant) => sql`
  INSERT INTO package_components
    (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
  VALUES (${tenant.company},${IDS.component},${tenant.business},${IDS.entitlement},${ORDER_IDS.service},1,
    'Synthetic service',10.000,3,30.000)`;

const slotSql = (tenant: Tenant, ordinal: number) => sql`
  INSERT INTO package_session_slots
    (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
  VALUES (${tenant.company},${slotId(ordinal)},${tenant.business},
    ${IDS.entitlement},${IDS.component},${ordinal},10.000,'FREE')`;

/** بيع كامل: الاستحقاق ومكوّنه وجلساته؛ القيمة المحفوظة 30.000 = السعر المدفوع. */
async function sell(tenant: Tenant, slots = 1): Promise<void> {
  await db.withTenant(tenant.company, async (tx) => {
    await tx.execute(entitlementSql(tenant));
    await tx.execute(componentSql(tenant));
    for (let ordinal = 1; ordinal <= slots; ordinal += 1) {
      await tx.execute(slotSql(tenant, ordinal));
    }
  });
}

const asTenant = (company: string, query: ReturnType<typeof sql>) =>
  db.withTenant(company, (tx) => tx.execute(query), { userId: USER });

type Failure = { code?: string; constraint_name?: string; cause?: Failure };

const detail = (error: unknown) => {
  const failure = error as Failure;
  return {
    code: failure?.code ?? failure?.cause?.code,
    constraint: failure?.constraint_name ?? failure?.cause?.constraint_name,
  };
};

async function rejected(work: Promise<unknown>, code: string, constraint?: string): Promise<void> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const found = detail(error);
  if (constraint === undefined) {
    expect(found.code).toBe(code);
    return;
  }
  expect([found.code, found.constraint]).toEqual([code, constraint]);
}

it.each(TABLES)('%s forces tenant isolation and hides rows without tenant context', async (table) => {
  expect(
    await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=${table}`,
  ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  expect(
    Array.from(
      await asTenant(
        A.company,
        sql`SELECT company_id FROM ${sql.identifier(table)} WHERE company_id=${B.company}`,
      ),
    ),
  ).toEqual([]);
  expect(
    Array.from(
      await asTenant(
        B.company,
        sql`SELECT company_id FROM ${sql.identifier(table)} WHERE company_id=${A.company}`,
      ),
    ),
  ).toEqual([]);
  const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await app.unsafe(`SELECT company_id FROM ${table}`)).toEqual([]);
  } finally {
    await app.end();
  }
});

it('same identifiers in two companies do not collide or expose foreign rows', async () => {
  await sell(A, 3);
  await sell(B, 3);
  expect(
    Array.from(
      await asTenant(
        A.company,
        sql`SELECT company_id,id FROM package_entitlements WHERE id=${IDS.entitlement}`,
      ),
    ),
  ).toEqual([{ company_id: A.company, id: IDS.entitlement }]);
  expect(
    Array.from(
      await asTenant(
        B.company,
        sql`SELECT company_id,id FROM package_entitlements WHERE id=${IDS.entitlement}`,
      ),
    ),
  ).toEqual([{ company_id: B.company, id: IDS.entitlement }]);
  expect(
    Array.from(
      await asTenant(
        A.company,
        sql`SELECT company_id,id FROM package_components WHERE id=${IDS.component}`,
      ),
    ),
  ).toEqual([{ company_id: A.company, id: IDS.component }]);
  expect(
    Array.from(
      await asTenant(
        A.company,
        sql`SELECT company_id,id FROM package_session_slots WHERE id=${slotId(1)}`,
      ),
    ),
  ).toEqual([{ company_id: A.company, id: slotId(1) }]);
});

it('cross-tenant writes are refused on every table', async () => {
  await rejected(asTenant(A.company, entitlementSql(B)), '42501');
  await rejected(asTenant(A.company, componentSql(B)), '42501');
  await rejected(asTenant(A.company, slotSql(B, 1)), '42501');
});

it('an upsert from another company is refused as well', async () => {
  await rejected(
    asTenant(
      A.company,
      sql`INSERT INTO package_entitlements
        (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
         price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
         sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on)
        VALUES (${B.company},${IDS.entitlement},${B.business},${ORDER_IDS.customer},${IDS.packageType},
          'SOLD','Foreign package',30,30.000,30.000,0.000,0,'CASH',${ORDER_IDS.employee},${B.branch},
          now(),current_date,'Asia/Kuwait',${USER},${ORDER_IDS.membership},current_date + 30)
        ON CONFLICT(company_id,id) DO UPDATE SET name_en=excluded.name_en`,
    ),
    '42501',
  );
});

it('the other runtime roles reach no package storage table', async () => {
  for (const url of ['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const) {
    const other = postgres(testDb[url], { max: 1, onnotice: () => undefined });
    try {
      for (const table of TABLES) {
        await expect(other.unsafe(`SELECT company_id FROM ${table}`)).rejects.toThrow(
          /permission denied/,
        );
      }
    } finally {
      await other.end();
    }
  }
});

it('delete and truncate are not granted to the application role', async () => {
  await rejected(asTenant(A.company, sql`DELETE FROM package_entitlements`), '42501');
  await rejected(asTenant(A.company, sql`TRUNCATE package_entitlements`), '42501');
  await rejected(asTenant(A.company, sql`DELETE FROM package_components`), '42501');
  await rejected(asTenant(A.company, sql`TRUNCATE package_session_slots`), '42501');
});
