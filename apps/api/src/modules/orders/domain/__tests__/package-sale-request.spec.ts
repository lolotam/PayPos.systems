import { systemUuidV7 } from '@pospay/ids';
import { expect, it } from 'vitest';
import { pendingPackageSale, type PackageSaleInput } from '../package-sale-request.ts';

const ids = systemUuidV7();

const facts = {
  id: ids.newId(),
  companyId: ids.newId(),
  businessId: ids.newId(),
  branchId: ids.newId(),
  recorderUserId: ids.newId(),
  recorderMembershipId: ids.newId(),
  limitBps: 1500,
  recordedAt: new Date('2026-10-15T08:00:00.000Z'),
};

const input: PackageSaleInput = {
  customer_id: ids.newId(),
  package_type_id: ids.newId(),
  expected_type_revision: 2,
  expected_service_revisions: [{ service_id: ids.newId(), revision: 1 }],
  price_paid: '50.000',
  paid_method: 'CARD',
  seller_employee_id: ids.newId(),
  sold_at: '2026-10-14T12:00:00.000Z',
};

it('maps every input field, sets status pending, freezes limitBps, converts sold_at string to Date, and copies recordedAt', () => {
  const result = pendingPackageSale(input, facts);
  expect(result).toEqual({
    company_id: facts.companyId,
    id: facts.id,
    business_id: facts.businessId,
    branch_id: facts.branchId,
    recorded_by: facts.recorderUserId,
    recorded_by_membership_id: facts.recorderMembershipId,
    discount_limit_bps: 1500,
    customer_id: input.customer_id,
    package_type_id: input.package_type_id,
    expected_type_revision: 2,
    expected_service_revisions: input.expected_service_revisions,
    price_paid: '50.000',
    paid_method: 'CARD',
    seller_employee_id: input.seller_employee_id,
    sold_at: new Date('2026-10-14T12:00:00.000Z'),
    recorded_at: facts.recordedAt,
    status: 'pending',
  });
});

it('freezes limitBps as null for unlimited and converts an omitted sold_at to null', () => {
  const result = pendingPackageSale({ ...input, sold_at: undefined }, { ...facts, limitBps: null });
  expect(result.discount_limit_bps).toBeNull();
  expect(result.sold_at).toBeNull();
});
