import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  packageSaleFixture,
  type PackageSaleFixture,
  type SellerOptions,
} from './package-sale.fixture.ts';

let f: PackageSaleFixture;
const RECORDED_AT = '2026-11-05T12:00:00.000Z';

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

const blowDry = () =>
  f.seedType({ price: '25.000', validityDays: 90, components: [{ sessions: 10, price: '3.000' }] });

// الرفض يثبت على صف الطلب، ومفيش ولا سطر مالي ولا تدقيق ولا حدث؛ وتاني تنفيذ ما يغيّرش حاجة.
async function expectRefusedAndUntouched(
  requestId: string,
  code: string,
  details?: unknown,
): Promise<void> {
  const before = await f.counts();
  await f.worker().execute(f.company, requestId);
  const state = await f.state(requestId);
  expect(state.status).toBe('failed');
  expect(state.error_code).toBe(code);
  expect(state.entitlement_id).toBeNull();
  expect(state.finished_at?.toISOString()).toBe(RECORDED_AT);
  if (details === undefined) expect(state.error_details).toBeNull();
  else expect(state.error_details).toEqual(details);
  expect(await f.counts()).toEqual(before);
  await f.worker().execute(f.company, requestId);
  expect(await f.state(requestId)).toEqual(state);
  expect(await f.counts()).toEqual(before);
}

it('refuses a discount above the frozen limit and writes nothing at all', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, price_paid: '21.000', discount_limit_bps: 1000 });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT', {
    limitBps: 1000,
    discountBps: 1600,
  });
});

it('sells when the discount is exactly at the frozen limit', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, price_paid: '22.500', discount_limit_bps: 1000 });
  await f.worker().execute(f.company, requestId);
  const state = await f.state(requestId);
  expect(state.status).toBe('completed');
  const sold = await f.sold(requestId);
  expect(sold.entitlements[0]).toMatchObject({ discount: '2.500', discount_bps: 1000 });
});

const ineligibleSellers: [string, SellerOptions][] = [
  ['a deleted seller', { deleted: true }],
  ['a seller detached from the branch before the sale day', { detachedOn: '2026-11-01' }],
  ['a seller hired after the sale day', { hireDate: '2026-11-10' }],
  ['a seller whose contract ended before the sale day', { contractEnd: '2026-10-31' }],
];

it.each(ineligibleSellers)('refuses a sale named to %s', async (_scenario, options) => {
  const type = await blowDry();
  const seller = await f.sellerWith(options);
  const requestId = await f.request({ type, seller_employee_id: seller });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_SELLER_NOT_ELIGIBLE');
});

it('refuses a sale named to the recorder herself', async () => {
  const type = await blowDry();
  const seller = await f.sellerWith({ linkedUserId: f.recorder });
  const requestId = await f.request({ type, seller_employee_id: seller });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_SELLER_SELF_FORBIDDEN');
});

it('refuses a sale named to a seller the business does not know', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, seller_employee_id: f.ids.newId() });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_SELLER_NOT_ELIGIBLE');
});

it('refuses a sale dated before the first of the previous month', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, sold_at: '2026-09-30T12:00:00Z' });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_SALE_TOO_OLD');
});

it('refuses a sale dated more than 120 seconds after the recorded request', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, sold_at: '2026-11-05T12:05:00Z' });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_SALE_IN_FUTURE');
});

it('refuses a sale for a customer the company does not know', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, customer_id: f.ids.newId() });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_CUSTOMER_NOT_FOUND');
});

it('refuses a sale for a customer of another company', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, customer_id: f.otherCustomer });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_CUSTOMER_NOT_FOUND');
});

it('refuses a sale of a package type the business does not know', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, package_type_id: f.ids.newId() });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_TYPE_NOT_FOUND');
});

it('refuses a sale of a package type that belongs to another business', async () => {
  const type = await f.seedType({
    price: '25.000',
    validityDays: 90,
    components: [{ sessions: 10, price: '3.000' }],
    businessId: f.otherBusiness,
  });
  const requestId = await f.request({ type });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_TYPE_NOT_FOUND');
});

it('refuses a quote whose package type revision moved and reports the current revision', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  await f.owner`UPDATE package_types SET price='27.500', revision=2 WHERE id=${type.typeId}`;
  await expectRefusedAndUntouched(requestId, 'PACKAGE_TYPE_REVISION_CONFLICT', {
    current_revision: 2,
  });
});

it('refuses a quote whose service revision moved and reports the current service revisions', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type });
  await f.owner`UPDATE services SET price='3.500', revision=2 WHERE id=${f.serviceId(type, 0)}`;
  await expectRefusedAndUntouched(requestId, 'PACKAGE_SALE_QUOTE_STALE', {
    current_service_revisions: [{ service_id: f.serviceId(type, 0), revision: 2 }],
  });
});

it('refuses a quote whose service set is not the components of the package type', async () => {
  const type = await blowDry();
  const other = await blowDry();
  const requestId = await f.request({
    type,
    expected_service_revisions: [{ service_id: f.serviceId(other, 0), revision: 1 }],
  });
  await expectRefusedAndUntouched(requestId, 'PACKAGE_SALE_QUOTE_STALE', {
    current_service_revisions: [{ service_id: f.serviceId(type, 0), revision: 1 }],
  });
});

it('refuses a sale in a branch that was deactivated after the request was accepted', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, branch_id: f.inactiveBranch });
  await f.owner`UPDATE branches SET is_active=false WHERE id=${f.inactiveBranch}`;
  await expectRefusedAndUntouched(requestId, 'PACKAGE_SALE_FAILED');
});

it('keeps a request pending when its package type has no components to value', async () => {
  const type = await f.seedType({ price: '25.000', validityDays: 90, components: [] });
  const requestId = await f.request({
    type,
    expected_service_revisions: [{ service_id: f.ids.newId(), revision: 1 }],
  });
  const before = await f.counts();
  await expect(f.worker().execute(f.company, requestId)).rejects.toThrow('PACKAGE_SALE_RETRY');
  const state = await f.state(requestId);
  expect(state.status).toBe('pending');
  expect(state.error_code).toBeNull();
  expect(state.finished_at).toBeNull();
  expect(await f.counts()).toEqual(before);
});
