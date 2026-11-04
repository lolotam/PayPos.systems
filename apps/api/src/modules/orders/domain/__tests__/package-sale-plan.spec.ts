import { MONEY_MAX, sumMoney } from '@pospay/domain';
import { expect, it } from 'vitest';
import { PackageRuleError, PackageSalePricingError } from '../errors.ts';
import { planPackageSale, type PackageSalePlanInput } from '../package-sale-plan.ts';
import { allocationFixtures } from './fixtures/package-allocation.js';

const input: PackageSalePlanInput = {
  companyId: 'company',
  businessId: 'business',
  branchId: 'branch',
  customerId: 'customer',
  recorderUserId: 'recorder',
  recorderMembershipId: 'membership',
  paidMethod: 'CASH',
  pricePaid: 22500n,
  limitBps: 1000,
  soldAt: new Date('2026-10-01T08:00:00Z'),
  recordedAt: new Date('2026-10-01T08:00:00Z'),
  timezone: 'Asia/Kuwait',
  seller: {
    id: 'seller',
    user_id: 'seller-user',
    eligible: true,
    name_en: 'Seller',
    name_ar: null,
    clocked_in: false,
    approved_leave: false,
  },
  type: {
    id: 'type',
    name_en: 'Blow-dry x10',
    name_ar: 'سشوار ×١٠',
    price: 25000n,
    validity_days: 90,
    revision: 1,
    components: [
      {
        service_id: 'service',
        sessions: 10,
        position: 1,
        service: {
          id: 'service',
          name_en: 'Blow-dry',
          name_ar: 'سشوار',
          price: 3000n,
          rule: { kind: 'FOLLOW_PLAN' },
          counts: true,
          revision: 4,
        },
      },
    ],
  },
};
const baseService = input.type.components[0]?.service;
if (!baseService) throw new Error('fixture requires a service');
const identities = { saleId: 'sale', components: [{ serviceId: 'service', id: 'component' }] };

it('values the mixed bridal package by price times original sessions (SA-02)', () => {
  const components = [
    { id: 'hair', price: 20000n, sessions: 1 },
    { id: 'makeup', price: 15000n, sessions: 1 },
    { id: 'nails', price: 2500n, sessions: 2 },
  ].map(({ id, price, sessions }, index) => ({
    service_id: id,
    position: index + 1,
    sessions,
    service: { ...baseService, id, price },
  }));
  const ids = {
    saleId: 'sale',
    components: components.map(({ service_id }) => ({
      serviceId: service_id,
      id: `id-${service_id}`,
    })),
  };
  const plan = planPackageSale(
    { ...input, type: { ...input.type, price: 40000n, components }, pricePaid: 40000n },
    ids,
  );
  expect(plan.components.map((component) => component.component_value)).toEqual([
    20000n,
    15000n,
    5000n,
  ]);
  expect(plan.components.map((component) => component.slots.map((slot) => slot.unitValue))).toEqual(
    [[20000n], [15000n], [2500n, 2500n]],
  );
  expect(() =>
    planPackageSale(
      { ...input, type: { ...input.type, components } },
      {
        ...ids,
        components: ids.components.map((component) => ({ ...component, id: 'duplicate' })),
      },
    ),
  ).toThrow('PACKAGE_SALE_IDENTITIES_INVALID');
});

const expectedEntitlement = {
  id: 'sale',
  company_id: 'company',
  business_id: 'business',
  customer_id: 'customer',
  package_type_id: 'type',
  provenance: 'SOLD',
  name_en: 'Blow-dry x10',
  name_ar: 'سشوار ×١٠',
  validity_days: 90,
  list_price: 25000n,
  price_paid: 22500n,
  discount: 2500n,
  discount_bps: 1000,
  paid_method: 'CASH',
  seller_employee_id: 'seller',
  seller_linked_user_id: 'seller-user',
  sold_branch_id: 'branch',
  sold_at: '2026-10-01T08:00:00.000Z',
  sold_business_date: '2026-10-01',
  sold_timezone: 'Asia/Kuwait',
  late: false,
  expires_on: '2026-12-30',
  recorded_by: 'recorder',
  recorded_by_membership_id: 'membership',
  refunded_amount: 0n,
  revision: 1,
  external_ref: null,
  import_batch_id: null,
  import_row: null,
};

it('keeps the worked sale, commission source and immutable initial values exact (SA-01)', () => {
  const plan = planPackageSale(input, identities);
  expect(plan.entitlement).toEqual(expectedEntitlement);
  expect(plan.components[0]).toMatchObject({
    id: 'component',
    service_id: 'service',
    position: 1,
    list_price_snapshot: 3000n,
    sessions_total: 10,
    component_value: 22500n,
  });
  expect(plan.components[0]?.slots).toEqual(
    Array.from({ length: 10 }, (_, index) => ({
      ordinal: index + 1,
      unitValue: 2250n,
      state: 'FREE',
    })),
  );
  expect(plan.event).toEqual({
    sale_id: 'sale',
    business_id: 'business',
    branch_id: 'branch',
    sold_at: '2026-10-01T08:00:00.000Z',
    business_date: '2026-10-01',
    seller_employee_id: 'seller',
    price_paid: '22.500',
    refunded_amount: '0.000',
    status: 'SOLD',
    revision: 1,
    schema_version: 1,
  });
  expect(JSON.parse(JSON.stringify(plan.event))).toEqual(plan.event);
});
it.each(allocationFixtures)(
  'preserves the independent allocation/slot fixture: $name (SA-02)',
  (fixture) => {
    const components = fixture.components.map((component, index) => ({
      service_id: component.serviceId,
      sessions: component.sessions,
      position: index + 1,
      service: { ...baseService, id: component.serviceId, price: component.listPriceSnapshot },
    }));
    const ids = {
      saleId: 'sale',
      components: components
        .map(({ service_id }) => ({ serviceId: service_id, id: `id-${service_id}` }))
        .reverse(),
    };
    const plan = planPackageSale(
      {
        ...input,
        type: { ...input.type, components },
        pricePaid: fixture.pricePaid,
        limitBps: null,
      },
      ids,
    );
    expect(plan.components.map((component) => component.component_value)).toEqual(
      fixture.expectedValues,
    );
    expect(
      plan.components.map((component) => component.slots.map((slot) => slot.unitValue)),
    ).toEqual(fixture.expectedSlots);
    expect(plan.components.map((component) => component.id)).toEqual(
      components.map(({ service_id }) => `id-${service_id}`),
    );
    expect(
      sumMoney(
        plan.components.flatMap((component) => component.slots.map((slot) => slot.unitValue)),
      ),
    ).toBe(fixture.pricePaid);
  },
);

it.each([0n, 25000n, 27000n, MONEY_MAX])(
  'handles free/at-list/above-list/maximal payment %s (SA-04)',
  (pricePaid) => {
    const plan = planPackageSale(
      { ...input, pricePaid, limitBps: null, paidMethod: 'CARD' },
      identities,
    );
    expect(
      sumMoney(
        plan.components.flatMap((component) => component.slots.map((slot) => slot.unitValue)),
      ),
    ).toBe(pricePaid);
    expect(plan.entitlement.paid_method).toBe('CARD');
    if (pricePaid === 0n)
      expect(
        plan.components
          .flatMap((component) => component.slots)
          .every((slot) => slot.unitValue === 0n),
      ).toBe(true);
    if (pricePaid >= 25000n)
      expect(plan.entitlement).toMatchObject({ discount: 0n, discount_bps: 0 });
  },
);
it('refuses above-limit and malformed definitions before returning any plan', () => {
  expect(() => planPackageSale({ ...input, pricePaid: 21000n }, identities)).toThrow(
    PackageSalePricingError,
  );
  expect(() =>
    planPackageSale({ ...input, type: { ...input.type, components: [] } }, identities),
  ).toThrow(new PackageRuleError('INVALID_COMPONENTS'));
});
it('back-dates expiry but values at recording-time catalog prices (SA-07 / PK-Q23)', () => {
  const plan = planPackageSale(
    { ...input, recordedAt: new Date('2026-11-01T00:00:00Z') },
    identities,
  );
  expect(plan.entitlement).toMatchObject({
    late: true,
    expires_on: '2026-12-30',
    sold_business_date: '2026-10-01',
  });
  expect(plan.components[0]?.list_price_snapshot).toBe(3000n);
});
it('uses branch-local midnight for stored date, expiry and commission month (TD-4)', () => {
  const recordedAt = new Date('2026-10-31T21:30:00Z');
  const plan = planPackageSale({ ...input, soldAt: undefined, recordedAt }, identities);
  expect(plan.entitlement).toMatchObject({
    sold_business_date: '2026-11-01',
    sold_timezone: 'Asia/Kuwait',
    expires_on: '2027-01-30',
  });
  expect(plan.event.business_date).toBe('2026-11-01');
  expect(recordedAt.toISOString()).toBe('2026-10-31T21:30:00.000Z');
});
it('is deterministic, does not mutate inputs, and returns independent stored snapshots (SA-03)', () => {
  const original = structuredClone(input);
  const ids = structuredClone(identities);
  const first = planPackageSale(original, ids);
  expect(planPackageSale(original, ids)).toEqual(first);
  expect(original).toEqual(input);
  expect(ids).toEqual(identities);
  const source = original.type.components[0];
  if (!source) throw new Error('fixture requires component');
  source.service.price = 3500n;
  expect(first.components[0]?.list_price_snapshot).toBe(3000n);
  const stored = first.components[0];
  if (!stored) throw new Error('sale requires component');
  stored.slots[0] = { ordinal: 1, state: 'USED', unitValue: 2250n };
  expect(planPackageSale(input, identities).components[0]?.slots[0]?.state).toBe('FREE');
});
it.each(
  [
    [],
    [{ serviceId: 'foreign-service', id: 'id' }],
    [
      { serviceId: 'service', id: 'id' },
      { serviceId: 'service', id: 'duplicate' },
    ],
  ].map((components) => ({ components })),
)(
  'refuses mismatched pre-generated identity data as an internal invariant: $components',
  ({ components }) => {
    expect(() => planPackageSale(input, { saleId: 'sale', components })).toThrow(
      'PACKAGE_SALE_IDENTITIES_INVALID',
    );
  },
);
