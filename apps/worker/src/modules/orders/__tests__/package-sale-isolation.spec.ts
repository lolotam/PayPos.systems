import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { packageSaleFixture, type PackageSaleFixture } from './package-sale.fixture.ts';

let f: PackageSaleFixture;

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

const blowDry = () =>
  f.seedType({ price: '25.000', validityDays: 90, components: [{ sessions: 10, price: '3.000' }] });

async function pendingRequestOfOtherCompany(): Promise<string> {
  const id = f.ids.newId();
  await f.owner`INSERT INTO package_sale_requests(company_id,id,business_id,branch_id,recorded_by,
    recorded_by_membership_id,discount_limit_bps,customer_id,package_type_id,expected_type_revision,
    expected_service_revisions,price_paid,paid_method,seller_employee_id,sold_at,recorded_at,status)
    VALUES(${f.otherCompany},${id},${TENANT.B.business},${TENANT.B.branch},${f.recorder},${f.membership},1000,
      ${ORDER_IDS.customer},${f.ids.newId()},1,${f.owner.json([{ service_id: ORDER_IDS.service, revision: 1 }])},
      '25.000','CASH',${ORDER_IDS.employee},null,now(),'pending')`;
  return id;
}

it('hides another company request from the worker scope and writes nothing', async () => {
  const requestId = await pendingRequestOfOtherCompany();
  const before = await f.counts();
  await expect(f.worker().execute(f.company, requestId)).resolves.toBeUndefined();
  const state = await f.state(requestId);
  expect(state.status).toBe('pending');
  expect(state.entitlement_id).toBeNull();
  expect(state.finished_at).toBeNull();
  expect(await f.counts()).toEqual(before);
  const [sold] = await f.owner<{ sold: number }[]>`
    SELECT count(*)::int AS sold FROM package_entitlements WHERE company_id=${f.otherCompany}`;
  expect(sold?.sold).toBe(0);
});

it('refuses the app role any transition of a finished request', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  await f.worker().execute(f.company, requestId);
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(
        sql`UPDATE package_sale_requests SET status='failed',error_code='PACKAGE_SALE_FAILED',
          finished_at=now() WHERE id=${requestId}`,
      ),
    ),
  ).rejects.toMatchObject({
    cause: { code: '23514', message: 'PACKAGE_SALE_REQUEST_TRANSITION_INVALID' },
  });
  const state = await f.state(requestId);
  expect(state.status).toBe('completed');
});

it('refuses the app role any change to the body of a sale request', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE package_sale_requests SET price_paid='1.000' WHERE id=${requestId}`),
    ),
  ).rejects.toMatchObject({ cause: { code: '42501' } });
  const state = await f.state(requestId);
  expect(state.price_paid).toBe('25.000');
  expect(state.status).toBe('pending');
});
