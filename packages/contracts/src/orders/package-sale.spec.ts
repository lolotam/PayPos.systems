import { expect, it } from 'vitest';
import { acceptedPackageSale, packageSaleChanged, sellPackageInput } from './package-sale.js';

const customer = '01920000-0000-7000-8000-000000004001';
const packageType = '01920000-0000-7000-8000-000000004002';
const service = '01920000-0000-7000-8000-000000004003';
const seller = '01920000-0000-7000-8000-000000004004';
const branch = '01920000-0000-7000-8000-000000004005';

const input = {
  customer_id: customer,
  package_type_id: packageType,
  expected_type_revision: 3,
  expected_service_revisions: [{ service_id: service, revision: 2 }],
  price_paid: '20.000',
  paid_method: 'CARD' as const,
  seller_employee_id: seller,
};

const component = {
  id: '01920000-0000-7000-8000-000000004006',
  service_id: service,
  position: 1,
  name_en: 'Synthetic service 1',
  name_ar: null,
  list_price_snapshot: '7.125',
  sessions_total: 3,
  component_value: '21.375',
};

const entitlement = {
  id: '01920000-0000-7000-8000-000000004007',
  business_id: '01920000-0000-7000-8000-000000004008',
  customer_id: customer,
  package_type_id: packageType,
  sold_branch_id: branch,
  name_en: 'Synthetic package',
  name_ar: null,
  validity_days: 90,
  list_price: '30.000',
  price_paid: '20.000',
  discount: '10.000',
  discount_bps: 3334,
  paid_method: 'CARD' as const,
  seller_employee_id: seller,
  sold_at: '2026-10-17T12:00:00.000Z',
  sold_business_date: '2026-10-17',
  late: false,
  expires_on: '2027-01-15',
  refunded_amount: '0.000',
  revision: 1,
  components: [component],
};

const event = {
  sale_id: entitlement.id,
  business_id: entitlement.business_id,
  branch_id: branch,
  sold_at: entitlement.sold_at,
  business_date: '2026-10-17',
  seller_employee_id: seller,
  price_paid: '20.000',
  refunded_amount: '0.000',
  status: 'SOLD' as const,
  revision: 1,
  schema_version: 1 as const,
};

function withoutKey(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

it('accepts a sale input with or without the sale time and the recorder membership', () => {
  expect(sellPackageInput.parse(input)).toEqual(input);
  const parsed = sellPackageInput.parse({
    ...input,
    sold_at: '2026-10-17T12:00:00.000Z',
    recorder_membership_id: '01920000-0000-7000-8000-000000004009',
  });
  expect(parsed.sold_at).toBe('2026-10-17T12:00:00.000Z');
  expect(parsed.recorder_membership_id).toBe('01920000-0000-7000-8000-000000004009');
});

const longQuote = Array.from({ length: 21 }, (_, index) => ({
  service_id: `01920000-0000-7000-8000-${String(index).padStart(12, '0')}`,
  revision: 1,
}));

it.each([
  ['a bank transfer payment method (SA-06)', { paid_method: 'BANK_TRANSFER' }],
  ['a missing payment method (SA-06)', { paid_method: undefined }],
  ['a payment method outside cash and card', { paid_method: 'TRANSFER' }],
  ['a price with fewer than three decimals', { price_paid: '10.5' }],
  ['a price sent as a number', { price_paid: 10.5 }],
  ['an empty service quote', { expected_service_revisions: [] }],
  ['a quote longer than twenty services', { expected_service_revisions: longQuote }],
  ['a zero type revision', { expected_type_revision: 0 }],
  [
    'a zero service revision',
    { expected_service_revisions: [{ service_id: service, revision: 0 }] },
  ],
  [
    'a service quoted twice, case variants included',
    {
      expected_service_revisions: [
        { service_id: service, revision: 2 },
        { service_id: service.toUpperCase(), revision: 3 },
      ],
    },
  ],
  ['an expected_type_revision exceeding 2147483647', { expected_type_revision: 2147483648 }],
  [
    'a service revision exceeding 2147483647',
    { expected_service_revisions: [{ service_id: service, revision: 2147483648 }] },
  ],
  ['a sold_at timestamp in year zero', { sold_at: '0000-01-01T00:00:00Z' }],
  ['an unknown key', { note: 'extra' }],
])('refuses a sale input with %s', (_scenario, change) => {
  expect(sellPackageInput.safeParse({ ...input, ...change }).success).toBe(false);
});

it.each([
  ['expected_type_revision at upper bound', { expected_type_revision: 2147483647 }],
  [
    'service revision at upper bound',
    { expected_service_revisions: [{ service_id: service, revision: 2147483647 }] },
  ],
  ['a normal sold_at', { sold_at: '2026-10-17T12:00:00.000Z' }],
])('accepts a sale input with %s', (_scenario, change) => {
  expect(sellPackageInput.safeParse({ ...input, ...change }).success).toBe(true);
});

it('refuses an unknown key on the sale event', () => {
  expect(packageSaleChanged.safeParse({ ...event, note: 'extra' }).success).toBe(false);
});

it('publishes a sale event that carries the selling branch and the business date', () => {
  expect(packageSaleChanged.parse(event)).toEqual(event);
  expect(packageSaleChanged.safeParse({ ...event, status: 'REFUNDED' }).success).toBe(false);
  expect(packageSaleChanged.safeParse({ ...event, schema_version: 2 }).success).toBe(false);
  expect(packageSaleChanged.safeParse(withoutKey(event, 'branch_id')).success).toBe(false);
  expect(packageSaleChanged.safeParse(withoutKey(event, 'business_date')).success).toBe(false);
  expect(packageSaleChanged.safeParse({ ...event, business_date: '2026-13-45' }).success).toBe(
    false,
  );
});

it('parses an accepted package sale and rejects an extra key and a non-uuid', () => {
  const saleRequestId = '01920000-0000-7000-8000-000000004010';
  expect(acceptedPackageSale.parse({ sale_request_id: saleRequestId })).toEqual({
    sale_request_id: saleRequestId,
  });
  expect(
    acceptedPackageSale.safeParse({ sale_request_id: saleRequestId, extra: 'bad' }).success,
  ).toBe(false);
  expect(acceptedPackageSale.safeParse({ sale_request_id: 'not-a-uuid' }).success).toBe(false);
});
