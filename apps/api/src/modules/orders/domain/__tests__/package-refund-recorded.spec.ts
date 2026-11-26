import { packageRefundRecorded as packageRefundRecordedContract } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { expect, it } from 'vitest';
import {
  packageRefundRecorded,
  type PackageRefundRecordedFacts,
} from '../package-refund-recorded.ts';

const facts: PackageRefundRecordedFacts = {
  refundId: '01920000-0000-7000-8000-000000000001',
  entitlementId: '01920000-0000-7000-8000-000000000002',
  componentId: '01920000-0000-7000-8000-000000000003',
  businessId: '01920000-0000-7000-8000-000000000004',
  branchId: '01920000-0000-7000-8000-000000000005',
  sessions: 2,
  amount: parseMoney('4.500'),
  businessDate: '2026-11-26',
  refundedAt: new Date('2026-11-26T05:00:00.000Z'),
  entitlementRevision: 3,
};

it('maps every refund fact into the event payload', () => {
  expect(packageRefundRecorded(facts)).toEqual({
    schema_version: 1,
    refund_id: facts.refundId,
    entitlement_id: facts.entitlementId,
    component_id: facts.componentId,
    business_id: facts.businessId,
    branch_id: facts.branchId,
    sessions: 2,
    amount: '4.500',
    business_date: '2026-11-26',
    refunded_at: '2026-11-26T05:00:00.000Z',
    entitlement_revision: 3,
  });
});

it('formats amount via moneyToString and preserves trailing decimals', () => {
  expect(packageRefundRecorded({ ...facts, amount: 0n }).amount).toBe('0.000');
  expect(packageRefundRecorded({ ...facts, amount: 1250n }).amount).toBe('1.250');
});

it('never leaks reason, customer identity or actor fields and parses under the strict contract', () => {
  const noisy = {
    ...facts,
    reason: 'Synthetic refund reason',
    customer_name: 'Synthetic Customer',
    customerName: 'Synthetic Customer',
    phone: '+96550000000',
    refunded_by: '01920000-0000-7000-8000-000000000099',
    refundedByMembershipId: '01920000-0000-7000-8000-000000000098',
  } as PackageRefundRecordedFacts;
  const payload = packageRefundRecorded(noisy);
  expect(Object.keys(payload).sort()).toEqual([
    'amount',
    'branch_id',
    'business_date',
    'business_id',
    'component_id',
    'entitlement_id',
    'entitlement_revision',
    'refund_id',
    'refunded_at',
    'schema_version',
    'sessions',
  ]);
  expect(packageRefundRecordedContract.parse(payload)).toEqual(payload);
});
