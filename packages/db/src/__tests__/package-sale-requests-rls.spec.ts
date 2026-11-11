import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { seedOrders } from '../../test/orders-fixture.ts';
import { insertSaleRequest, type SaleRequestTenant } from '../../test/package-sale-request-fixture.ts';
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

async function asApp<T>(
  work: (tx: postgres.TransactionSql) => Promise<T>,
  tenant: SaleRequestTenant = TENANT.A,
) {
  return app.begin(async (tx) => {
    await tx`SELECT set_config('app.company_id', ${tenant.company}, true), set_config('app.user_id', ${USER}, true)`;
    return work(tx);
  });
}

function insertRequest(tx: postgres.TransactionSql, opts: { tenant: SaleRequestTenant; id: string }) {
  return insertSaleRequest(tx, { id: opts.id }, opts.tenant);
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
