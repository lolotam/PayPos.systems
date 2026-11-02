import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../test/orders-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createDatabase, type Database } from '../index.ts';

const { A } = TENANT;
const PACKAGE_TYPE = '01920000-0000-7000-8000-00000000f401';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let serial = 0;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES (${A.company},${PACKAGE_TYPE},${A.business},'Synthetic package',30.000,30)`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => nextId() } });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function nextId(): string {
  serial += 1;
  return `01920000-0000-7000-8000-00000000f${serial.toString(16).padStart(3, '0')}`;
}

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

interface MoneyOptions {
  pricePaid?: string;
  listPrice?: string;
  discount?: string;
  refundedAmount?: string;
}

const entitlementInsert = (id: string, o: MoneyOptions = {}) => sql`
  INSERT INTO package_entitlements
    (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
     price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
     sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on,refunded_amount)
  VALUES (${A.company},${id},${A.business},${ORDER_IDS.customer},${PACKAGE_TYPE},'SOLD','Synthetic package',30,
    ${o.listPrice ?? '30.000'},${o.pricePaid ?? '30.000'},${o.discount ?? '0.000'},0,'CASH',${ORDER_IDS.employee},
    ${A.branch},now(),current_date,'Asia/Kuwait',${USER},${ORDER_IDS.membership},current_date + 30,
    ${o.refundedAmount ?? '0.000'})`;

const componentInsert = (
  id: string,
  entitlementId: string,
  value: string,
  listPrice?: string,
) => sql`
  INSERT INTO package_components
    (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
  VALUES (${A.company},${id},${A.business},${entitlementId},${ORDER_IDS.service},1,'Synthetic service',
    ${listPrice ?? '10.000'},3,${value})`;

const slotInsert = (id: string, entitlementId: string, componentId: string, value: string) => sql`
  INSERT INTO package_session_slots
    (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
  VALUES (${A.company},${id},${A.business},${entitlementId},${componentId},1,${value},'FREE')`;

const attempt = (statement: ReturnType<typeof sql>) =>
  db.withTenant(A.company, (tx) => tx.execute(statement));

it('a money column is never negative and never NaN', async () => {
  const cases: [string, ReturnType<typeof sql>, string][] = [
    [
      'a negative price paid',
      entitlementInsert(nextId(), { pricePaid: '-1.000' }),
      'package_entitlements_price_paid_check',
    ],
    [
      'a NaN price paid',
      entitlementInsert(nextId(), { pricePaid: 'NaN' }),
      'package_entitlements_price_paid_check',
    ],
    [
      'a negative list price',
      entitlementInsert(nextId(), { listPrice: '-1.000' }),
      'package_entitlements_list_price_check',
    ],
    [
      'a negative discount',
      entitlementInsert(nextId(), { discount: '-1.000' }),
      'package_entitlements_discount_check',
    ],
    [
      'a negative refunded amount',
      entitlementInsert(nextId(), { refundedAmount: '-1.000' }),
      'package_entitlements_initial_refunded_amount',
    ],
    [
      'a negative component value',
      componentInsert(nextId(), nextId(), '-5.000'),
      'package_components_value_check',
    ],
    [
      'a NaN component value',
      componentInsert(nextId(), nextId(), 'NaN'),
      'package_components_value_check',
    ],
    [
      'a negative component list price',
      componentInsert(nextId(), nextId(), '30.000', '-1.000'),
      'package_components_list_price_check',
    ],
    [
      'a negative session value',
      slotInsert(nextId(), nextId(), nextId(), '-1.000'),
      'package_session_slots_unit_value_check',
    ],
    [
      'a NaN session value',
      slotInsert(nextId(), nextId(), nextId(), 'NaN'),
      'package_session_slots_unit_value_check',
    ],
  ];
  for (const [label, statement, constraint] of cases) {
    expect(label).toBeTruthy();
    await rejected(attempt(statement), '23514', constraint);
  }
});

it('a price that balances with a negative component is still refused', async () => {
  const entitlementId = nextId();
  await rejected(
    db.withTenant(A.company, async (tx) => {
      await tx.execute(
        entitlementInsert(entitlementId, { pricePaid: '10.000', listPrice: '10.000' }),
      );
      await tx.execute(componentInsert(nextId(), entitlementId, '-5.000'));
      await tx.execute(componentInsert(nextId(), entitlementId, '15.000'));
    }),
    '23514',
    'package_components_value_check',
  );
});
