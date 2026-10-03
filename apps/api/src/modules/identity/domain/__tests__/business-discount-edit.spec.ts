import { expect, it } from 'vitest';
import { businessDiscountEditFailure } from '../business-discount-edit.ts';
import type { AccessGrant } from '../access.ts';

const target = { companyId: 'company', businessId: 'business' };
const descendants = [{ ...target, branchId: 'branch' }];
const management: AccessGrant = {
  permission: 'manage:settings:business',
  effect: 'ALLOW',
  scopeType: 'BUSINESS',
  scopeId: 'business',
};
const discount: AccessGrant = { ...management, permission: 'manage:discounts:company' };
const grants = [management, discount];
it('requires settings management at an existing business', () => {
  expect(businessDiscountEditFailure(grants, target, descendants)).toBeNull();
  expect(businessDiscountEditFailure(grants, null, [])).toBe('FORBIDDEN');
  expect(businessDiscountEditFailure(grants.slice(1), target, [])).toBe('FORBIDDEN');
});
it('requires effective possession throughout the business, with DENY winning', () => {
  expect(businessDiscountEditFailure(grants.slice(0, 1), target, [])).toBe('PERMISSION_NOT_HELD');
  expect(
    businessDiscountEditFailure([...grants, { ...discount, effect: 'DENY' }], target, []),
  ).toBe('PERMISSION_NOT_HELD');
  expect(
    businessDiscountEditFailure(
      [...grants, { ...discount, effect: 'DENY', scopeType: 'BRANCH', scopeId: 'branch' }],
      target,
      descendants,
    ),
  ).toBe('PERMISSION_NOT_HELD');
});
it('refuses business and branch grants outside the requested reach', () => {
  for (const grant of [
    { ...discount, scopeId: 'other-business' },
    { ...discount, scopeType: 'BRANCH' as const, scopeId: 'branch' },
  ])
    expect(businessDiscountEditFailure([management, grant], target, descendants)).toBe(
      'PERMISSION_SCOPE_OUTSIDE_REACH',
    );
});
