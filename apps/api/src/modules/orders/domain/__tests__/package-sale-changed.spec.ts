import { packageSaleChanged as packageSaleChangedContract } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { expect, it } from 'vitest';
import { packageSaleChanged } from '../package-sale-changed.js';

const facts = {
  saleId: '01920000-0000-7000-8000-000000000001',
  businessId: '01920000-0000-7000-8000-000000000002',
  branchId: '01920000-0000-7000-8000-000000000003',
  soldAt: new Date('2026-10-01T08:00:00.000Z'),
  businessDate: '2026-10-20',
  sellerEmployeeId: '01920000-0000-7000-8000-000000000004',
  pricePaid: parseMoney('22.500'),
  refundedAmount: parseMoney('18.000'),
  revision: 2,
};

it('maps every sale fact into the event payload', () => {
  expect(packageSaleChanged(facts)).toEqual({
    sale_id: facts.saleId,
    business_id: facts.businessId,
    branch_id: facts.branchId,
    sold_at: '2026-10-01T08:00:00.000Z',
    business_date: '2026-10-20',
    seller_employee_id: facts.sellerEmployeeId,
    price_paid: '22.500',
    refunded_amount: '18.000',
    status: 'SOLD',
    revision: 2,
    schema_version: 1,
  });
});

it('writes money as three-decimal strings', () => {
  const payload = packageSaleChanged({ ...facts, pricePaid: 1000n, refundedAmount: 2250n });
  expect(payload.price_paid).toBe('1.000');
  expect(payload.refunded_amount).toBe('2.250');
});

it('carries a zero refunded amount for a sale that was not refunded', () => {
  const payload = packageSaleChanged({ ...facts, refundedAmount: 0n, revision: 1 });
  expect(payload.refunded_amount).toBe('0.000');
  expect(payload.revision).toBe(1);
});

it('parses through the strict event contract', () => {
  const payload = packageSaleChanged(facts);
  expect(packageSaleChangedContract.parse(payload)).toEqual(payload);
  expect(packageSaleChangedContract.safeParse({ ...payload, extra: 'x' }).success).toBe(false);
  expect(packageSaleChangedContract.safeParse({ ...payload, status: 'REFUNDED' }).success).toBe(false);
  expect(packageSaleChangedContract.safeParse({ ...payload, schema_version: 2 }).success).toBe(false);
});
