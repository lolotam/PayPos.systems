import { afterAll, beforeAll, expect, it } from 'vitest';
import { packageSaleChanged } from '@pospay/contracts';
import { moneyToString } from '@pospay/domain';
import { allocationFixtures } from '../../../../../../packages/domain/src/__tests__/package-allocation.vectors.ts';
import {
  packageSaleFixture,
  type PackageSaleFixture,
  type SeededType,
  type SoldRows,
} from './package-sale.fixture.ts';

let f: PackageSaleFixture;
const RECORDED_AT = '2026-11-05T12:00:00.000Z';

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  if (f) await f.close();
});

// المبلغ في الاختبار نص عشري بالدينار؛ المجموع بيتحسب بالفلس عشان ما ينفعش float.
const mills = (value: string): bigint => BigInt(value.replace('.', ''));
const total = (values: readonly string[]): bigint =>
  values.reduce((sum, value) => sum + mills(value), 0n);

const blowDry = () =>
  f.seedType({ price: '25.000', validityDays: 90, components: [{ sessions: 10, price: '3.000' }] });

function expectOneComponentWithTenSlots(sold: SoldRows, type: SeededType): void {
  expect(sold.components).toHaveLength(1);
  expect(sold.components[0]).toMatchObject({
    service_id: f.serviceId(type, 0),
    position: 1,
    list_price_snapshot: '3.000',
    sessions_total: 10,
    component_value: '22.500',
  });
  expect(sold.slots).toHaveLength(10);
  expect(sold.slots.map((slot) => slot.unit_value)).toEqual(Array(10).fill('2.250'));
  expect(sold.slots.every((slot) => slot.state === 'FREE')).toBe(true);
  expect(total(sold.slots.map((slot) => slot.unit_value))).toBe(22_500n);
}

function expectOneAuditAndOneEvent(sold: SoldRows, entitlementId: string | null): void {
  expect(sold.audit).toHaveLength(1);
  expect(sold.audit[0]).toMatchObject({
    entity: 'package_entitlement',
    entity_id: entitlementId,
    action: 'package.sold',
    actor_user_id: f.recorder,
  });
  expect(sold.events).toHaveLength(1);
  expect(sold.events[0]).toMatchObject({
    aggregate_type: 'package_entitlement',
    aggregate_id: entitlementId,
    event_type: 'PackageSaleChanged',
  });
  expect(packageSaleChanged.parse(sold.events[0]?.payload)).toEqual({
    sale_id: entitlementId,
    business_id: f.business,
    branch_id: f.branch,
    sold_at: RECORDED_AT,
    business_date: '2026-11-05',
    seller_employee_id: f.seller,
    price_paid: '22.500',
    refunded_amount: '0.000',
    status: 'SOLD',
    revision: 1,
    schema_version: 1,
  });
}

it('completes one sale with the frozen money, ten free slots, one audit entry and one sale event', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, price_paid: '22.500', paid_method: 'CASH' });
  await f.worker().execute(f.company, requestId);
  const state = await f.state(requestId);
  expect(state.status).toBe('completed');
  expect(state.error_code).toBeNull();
  expect(state.finished_at?.toISOString()).toBe(RECORDED_AT);
  const sold = await f.sold(requestId);
  expect(sold.entitlements).toHaveLength(1);
  const [entitlement] = sold.entitlements;
  expect(entitlement).toMatchObject({
    provenance: 'SOLD',
    list_price: '25.000',
    price_paid: '22.500',
    discount: '2.500',
    discount_bps: 1000,
    revision: 1,
    refunded_amount: '0.000',
    validity_days: 90,
    paid_method: 'CASH',
    seller_employee_id: f.seller,
    sold_branch_id: f.branch,
    sold_business_date: '2026-11-05',
    expires_on: '2027-02-03',
    late: false,
    recorded_by: f.recorder,
    recorded_by_membership_id: f.membership,
  });
  expect(entitlement?.id).toBe(state.entitlement_id);
  expect(entitlement?.sold_at.toISOString()).toBe(state.recorded_at.toISOString());
  expectOneComponentWithTenSlots(sold, type);
  expectOneAuditAndOneEvent(sold, entitlement?.id ?? null);
});

it('splits a mixed package by its list-price weights and keeps every slot inside the paid amount', async () => {
  const type = await f.seedType({
    price: '40.000',
    validityDays: 90,
    components: [
      { sessions: 1, price: '20.000' },
      { sessions: 1, price: '15.000' },
      { sessions: 2, price: '2.500' },
    ],
  });
  const requestId = await f.request({ type, price_paid: '40.000' });
  await f.worker().execute(f.company, requestId);
  const sold = await f.sold(requestId);
  expect(sold.entitlements[0]).toMatchObject({ discount: '0.000', discount_bps: 0 });
  expect(sold.components.map((component) => component.component_value)).toEqual([
    '20.000',
    '15.000',
    '5.000',
  ]);
  expect(sold.slots.map((slot) => slot.unit_value)).toEqual(['20.000', '15.000', '2.500', '2.500']);
  expect(total(sold.slots.map((slot) => slot.unit_value))).toBe(40_000n);
});

it('keeps the remainder mill in the allocation so the slots still sum to the paid price', async () => {
  const vector = allocationFixtures[0];
  const type = await f.seedType({
    price: '20.000',
    validityDays: 90,
    components: [
      { sessions: 1, price: '10.000' },
      { sessions: 2, price: '10.000' },
    ],
  });
  const requestId = await f.request({ type, price_paid: '10.001', discount_limit_bps: null });
  await f.worker().execute(f.company, requestId);
  const sold = await f.sold(requestId);
  expect(sold.components.map((component) => component.component_value)).toEqual(
    vector.expectedValues.map((value) => moneyToString(value)),
  );
  expect(sold.slots.map((slot) => slot.unit_value)).toEqual(
    vector.expectedSlots.flat().map((value) => moneyToString(value)),
  );
  expect(total(sold.slots.map((slot) => slot.unit_value))).toBe(mills('10.001'));
});

it('keeps the sold snapshot when the package type and the service price change after the sale', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, price_paid: '22.500' });
  await f.worker().execute(f.company, requestId);
  const before = await f.sold(requestId);
  await f.owner`UPDATE package_types SET price='27.500', revision=2 WHERE id=${type.typeId}`;
  await f.owner`UPDATE services SET price='3.500', revision=2 WHERE id=${f.serviceId(type, 0)}`;
  const after = await f.sold(requestId);
  expect(after.entitlements).toEqual(before.entitlements);
  expect(after.components).toEqual(before.components);
  expect(after.slots).toEqual(before.slots);
});

it('accepts a payment above the package type price with no discount at all', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, price_paid: '27.000' });
  await f.worker().execute(f.company, requestId);
  const sold = await f.sold(requestId);
  expect(sold.entitlements[0]).toMatchObject({
    list_price: '25.000',
    price_paid: '27.000',
    discount: '0.000',
    discount_bps: 0,
  });
  expect(total(sold.slots.map((slot) => slot.unit_value))).toBe(27_000n);
});

it('sells for an unlimited recorder at zero and leaves every session worth zero', async () => {
  const type = await blowDry();
  const requestId = await f.request({ type, price_paid: '0.000', discount_limit_bps: null });
  await f.worker().execute(f.company, requestId);
  const sold = await f.sold(requestId);
  expect(sold.entitlements[0]).toMatchObject({
    price_paid: '0.000',
    discount: '25.000',
    discount_bps: 10000,
  });
  expect(sold.slots).toHaveLength(10);
  expect(sold.slots.every((slot) => slot.unit_value === '0.000')).toBe(true);
});

it('accepts a back-dated sale inside the window as late and dates the expiry from the sale day', async () => {
  const type = await blowDry();
  const requestId = await f.request({
    type,
    price_paid: '22.500',
    sold_at: '2026-10-01T00:00:00Z',
  });
  await f.worker().execute(f.company, requestId);
  const sold = await f.sold(requestId);
  expect(sold.entitlements[0]).toMatchObject({
    late: true,
    sold_business_date: '2026-10-01',
    expires_on: '2026-12-30',
  });
  expect(sold.entitlements[0]?.sold_at.toISOString()).toBe('2026-10-01T00:00:00.000Z');
});
