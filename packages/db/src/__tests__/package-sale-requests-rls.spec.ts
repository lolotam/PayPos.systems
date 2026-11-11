import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../test/orders-fixture.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;

const idA = randomUUID();
const idB = randomUUID();

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  app = postgres(testDb.appUrl, { max: 2, onnotice: () => undefined });

  await asApp(async (tx) => {
    await insertRequest(tx, { tenant: TENANT.A, id: idA });
  }, TENANT.A);

  await asApp(async (tx) => {
    await insertRequest(tx, { tenant: TENANT.B, id: idB });
  }, TENANT.B);
});

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await testDb?.drop();
});

type Tenant = { company: string; business: string; branch: string };

async function asApp<T>(
  work: (tx: postgres.TransactionSql) => Promise<T>,
  tenant: Tenant = TENANT.A,
) {
  return app.begin(async (tx) => {
    await tx`SELECT set_config('app.company_id', ${tenant.company}, true), set_config('app.user_id', ${USER}, true)`;
    return work(tx);
  });
}

function insertRequest(
  tx: postgres.TransactionSql,
  opts: { tenant: Tenant; id: string },
) {
  const t = opts.tenant;
  return tx`
    INSERT INTO package_sale_requests (
      company_id, id, business_id, branch_id, recorded_by, recorded_by_membership_id,
      discount_limit_bps, customer_id, package_type_id, expected_type_revision,
      expected_service_revisions, price_paid, paid_method, seller_employee_id,
      sold_at, recorded_at, status
    ) VALUES (
      ${t.company}, ${opts.id}, ${t.business}, ${t.branch}, ${USER}, ${ORDER_IDS.membership},
      1000, ${ORDER_IDS.customer}, ${randomUUID()}, 1,
      ${tx.json([{ service_id: ORDER_IDS.service, revision: 1, list_price: '1.000' }])},
      25.000, 'CASH', ${ORDER_IDS.employee},
      now(), now(), 'pending'
    )
  `;
}

it('cross-tenant read returns 0 rows', async () => {
  const rowsA = await asApp(
    (tx) => tx`SELECT id FROM package_sale_requests WHERE id = ${idA}`,
    TENANT.A,
  );
  expect(rowsA).toEqual([{ id: idA }]);

  const hiddenFromA = await asApp(
    (tx) => tx`SELECT id FROM package_sale_requests WHERE id = ${idB}`,
    TENANT.A,
  );
  expect(hiddenFromA).toHaveLength(0);

  const crossCompanyFromA = await asApp(
    (tx) => tx`SELECT id FROM package_sale_requests WHERE company_id = ${TENANT.B.company}`,
    TENANT.A,
  );
  expect(crossCompanyFromA).toHaveLength(0);

  const rowsB = await asApp(
    (tx) => tx`SELECT id FROM package_sale_requests WHERE id = ${idB}`,
    TENANT.B,
  );
  expect(rowsB).toEqual([{ id: idB }]);

  const hiddenFromB = await asApp(
    (tx) => tx`SELECT id FROM package_sale_requests WHERE id = ${idA}`,
    TENANT.B,
  );
  expect(hiddenFromB).toHaveLength(0);

  const unauthedRows = await app`SELECT id FROM package_sale_requests`;
  expect(unauthedRows).toHaveLength(0);
});

it('cross-tenant insert is refused by RLS WITH CHECK', async () => {
  await expect(
    asApp(
      (tx) =>
        insertRequest(tx, {
          tenant: { company: TENANT.B.company, business: TENANT.A.business, branch: TENANT.A.branch },
          id: randomUUID(),
        }),
      TENANT.A,
    ),
  ).rejects.toMatchObject({ code: '42501' });
});

it('cross-tenant update is refused', async () => {
  const touched = await asApp(
    (tx) =>
      tx`UPDATE package_sale_requests SET status = 'failed', error_code = 'ERR', finished_at = now()
         WHERE company_id = ${TENANT.B.company} AND id = ${idB} RETURNING id`,
    TENANT.A,
  );
  expect(touched).toHaveLength(0);

  await expect(
    asApp(
      (tx) =>
        tx`UPDATE package_sale_requests SET company_id = ${TENANT.B.company}
           WHERE id = ${idA}`,
      TENANT.A,
    ),
  ).rejects.toMatchObject({ code: '42501' });
});
