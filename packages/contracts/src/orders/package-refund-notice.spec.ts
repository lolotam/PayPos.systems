import { expect, it } from 'vitest';
import { customerPackageDetail, customerPackageRefund } from './customer-packages.js';
import { packageRefundNoticeRequested, packageRefundRecorded } from './package-refund-notice.js';

const id = '01920000-0000-7000-8000-000000004001';
const otherId = '01920000-0000-7000-8000-000000004002';

const validRecorded = {
  schema_version: 1 as const,
  refund_id: id,
  entitlement_id: otherId,
  component_id: id,
  business_id: otherId,
  branch_id: id,
  sessions: 3,
  amount: '7.500',
  business_date: '2026-11-20',
  refunded_at: '2026-11-20T09:30:00.000Z',
  entitlement_revision: 2,
};

const validRecipient = {
  channel: 'IN_APP' as const,
  user_id: id,
  locale: 'ar' as const,
  template_key: 'package_refund_recorded' as const,
  template_revision: 1 as const,
  safe_parameters: [
    { name: 'package_name_ar', type: 'text', value: 'باقة شعر' },
    { name: 'package_name_en', type: 'text', value: 'Hair package' },
    { name: 'branch_name_ar', type: 'text', value: 'فرع السالمية' },
    { name: 'branch_name_en', type: 'text', value: 'Salmiya branch' },
    { name: 'sessions', type: 'text', value: '3' },
    { name: 'amount', type: 'text', value: '7.500' },
    { name: 'business_date', type: 'text', value: '2026-11-20' },
  ],
};

const validRequested = {
  schema_version: 1 as const,
  refund_id: id,
  entitlement_id: otherId,
  business_id: otherId,
  branch_id: id,
  business_date: '2026-11-20',
  business_timezone: 'Asia/Kuwait',
  notification_recipients: [validRecipient],
};

it('parses the refund event with its money, sessions and revision', () => {
  expect(packageRefundRecorded.parse(validRecorded)).toEqual(validRecorded);
});

it.each(['reason', 'phone', 'customer_name', 'refunded_by'])(
  'refuses the private field %s on the refund event',
  (field) => {
    expect(packageRefundRecorded.safeParse({ ...validRecorded, [field]: 'secret' }).success).toBe(
      false,
    );
  },
);

it('refuses a refund event with a session count outside the slot bounds', () => {
  expect(packageRefundRecorded.safeParse({ ...validRecorded, sessions: 0 }).success).toBe(false);
  expect(packageRefundRecorded.safeParse({ ...validRecorded, sessions: 366 }).success).toBe(false);
  expect(
    packageRefundRecorded.safeParse({ ...validRecorded, entitlement_revision: 1 }).success,
  ).toBe(false);
});

it('parses the notice request with its recipients', () => {
  expect(packageRefundNoticeRequested.parse(validRequested)).toEqual(validRequested);
});

it.each(['reason', 'phone', 'customer_name'])(
  'refuses the private field %s on the notice request',
  (field) => {
    expect(
      packageRefundNoticeRequested.safeParse({ ...validRequested, [field]: 'secret' }).success,
    ).toBe(false);
    expect(
      packageRefundNoticeRequested.safeParse({
        ...validRequested,
        notification_recipients: [{ ...validRecipient, [field]: 'secret' }],
      }).success,
    ).toBe(false);
  },
);

it('refuses a notice request without a recipient or beyond a hundred', () => {
  expect(
    packageRefundNoticeRequested.safeParse({ ...validRequested, notification_recipients: [] })
      .success,
  ).toBe(false);
  expect(
    packageRefundNoticeRequested.safeParse({
      ...validRequested,
      notification_recipients: Array.from({ length: 101 }, () => validRecipient),
    }).success,
  ).toBe(false);
});

const validRefund = {
  id,
  component_id: otherId,
  sessions: 3,
  amount: '7.500',
  method: 'CASH' as const,
  reason: 'The customer changed her mind.',
  refunded_at: '2026-11-20T09:30:00.000Z',
};

it('parses a refund history row with its reason and method', () => {
  expect(customerPackageRefund.parse(validRefund)).toEqual(validRefund);
  expect(customerPackageRefund.safeParse({ ...validRefund, method: 'TRANSFER' }).success).toBe(
    false,
  );
});

it('defaults can_refund to false and refunds to an empty list', () => {
  const detail = customerPackageDetail.parse({
    id,
    customer_id: otherId,
    package_type_id: null,
    provenance: 'SOLD',
    name_en: 'Synthetic package',
    name_ar: null,
    validity_days: 90,
    list_price: '20.000',
    price_paid: '20.000',
    discount: '0.000',
    discount_bps: 0,
    paid_method: 'CASH',
    seller_employee_id: null,
    seller_linked_user_id: null,
    sold_branch_id: id,
    sold_at: '2026-10-01T08:00:00.000Z',
    sold_business_date: '2026-10-01',
    expires_on: '2026-12-30',
    refunded_amount: '7.500',
    revision: 2,
    components: [],
    redemptions: [],
  });
  expect(detail.can_refund).toBe(false);
  expect(detail.refunds).toEqual([]);
  expect(customerPackageDetail.safeParse({ ...detail, can_refund: 'yes' }).success).toBe(false);
});

it('carries the refund history rows on the detail', () => {
  const detail = customerPackageDetail.parse({
    id,
    customer_id: otherId,
    package_type_id: null,
    provenance: 'SOLD',
    name_en: 'Synthetic package',
    name_ar: null,
    validity_days: 90,
    list_price: '20.000',
    price_paid: '20.000',
    discount: '0.000',
    discount_bps: 0,
    paid_method: 'CASH',
    seller_employee_id: null,
    seller_linked_user_id: null,
    sold_branch_id: id,
    sold_at: '2026-10-01T08:00:00.000Z',
    sold_business_date: '2026-10-01',
    expires_on: '2026-12-30',
    refunded_amount: '7.500',
    revision: 2,
    can_refund: true,
    components: [],
    redemptions: [],
    refunds: [validRefund],
  });
  expect(detail.can_refund).toBe(true);
  expect(detail.refunds).toEqual([validRefund]);
});
