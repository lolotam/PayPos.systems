import { expect, it } from 'vitest';
import {
  decideDiscountApprovers,
  type DiscountApproverBranch,
  type DiscountApproverGrant,
  type DiscountApproverInput,
} from '../discount-approver-access.ts';

const branch: DiscountApproverBranch = {
  companyId: '01920000-0000-7000-8000-0000000000a0',
  businessId: '01920000-0000-7000-8000-0000000000a1',
  branchId: '01920000-0000-7000-8000-0000000000a2',
};
const otherBranch = '01920000-0000-7000-8000-0000000000b2';
const otherBusiness = '01920000-0000-7000-8000-0000000000b1';
const otherCompany = '01920000-0000-7000-8000-0000000000b0';
const grant = (
  userId: string,
  membershipId: string,
  overrides: Partial<DiscountApproverGrant> = {},
): DiscountApproverGrant => ({
  userId,
  membershipId,
  effect: 'ALLOW',
  scopeType: 'BRANCH',
  scopeId: branch.branchId,
  ...overrides,
});
const decide = (input: Partial<DiscountApproverInput>) =>
  decideDiscountApprovers({ branch, owners: [], grants: [], ...input });

it('a role grant at the branch scope is a recipient', () => {
  expect(decide({ grants: [grant('manager', 'm1')] })).toEqual(['manager']);
});

it('a cashier granted the permission by name is a recipient', () => {
  expect(decide({ grants: [grant('cashier', 'm1')] })).toEqual(['cashier']);
});

it('a user without the permission is not a recipient', () => {
  expect(decide({})).toEqual([]);
});

it('a DENY at the branch scope excludes the holder', () => {
  expect(
    decide({
      grants: [grant('manager', 'm1'), grant('manager', 'm1', { effect: 'DENY' })],
    }),
  ).toEqual([]);
});

it('a DENY of another membership still excludes when its own scope covers the target', () => {
  expect(
    decide({
      grants: [grant('manager', 'm1'), grant('manager', 'm2', { effect: 'DENY' })],
    }),
  ).toEqual([]);
});

it('a DENY at another branch does not exclude the holder', () => {
  expect(
    decide({
      grants: [
        grant('manager', 'm1'),
        grant('manager', 'm1', { effect: 'DENY', scopeId: otherBranch }),
      ],
    }),
  ).toEqual(['manager']);
});

it('an owner ignores a DENY', () => {
  expect(
    decide({
      owners: ['owner'],
      grants: [grant('owner', 'm1'), grant('owner', 'm1', { effect: 'DENY' })],
    }),
  ).toEqual(['owner']);
});

it('a holder only at another branch is not a recipient', () => {
  expect(decide({ grants: [grant('manager', 'm1', { scopeId: otherBranch })] })).toEqual([]);
});

it('an override allowed at another branch does not count', () => {
  expect(decide({ grants: [grant('cashier', 'm1', { scopeId: otherBranch })] })).toEqual([]);
});

it('an ALLOW override scoped to the target branch counts, whatever the membership scope is', () => {
  expect(decide({ grants: [grant('cashier', 'm1')] })).toEqual(['cashier']);
});

it('a business-wide grant covers the branch of that business only', () => {
  expect(
    decide({
      grants: [grant('manager', 'm1', { scopeType: 'BUSINESS', scopeId: branch.businessId })],
    }),
  ).toEqual(['manager']);
  expect(
    decide({
      grants: [grant('manager', 'm1', { scopeType: 'BUSINESS', scopeId: otherBusiness })],
    }),
  ).toEqual([]);
});

it('a company-wide grant covers the branch, and another company does not', () => {
  expect(
    decide({
      grants: [grant('manager', 'm1', { scopeType: 'COMPANY', scopeId: branch.companyId })],
    }),
  ).toEqual(['manager']);
  expect(
    decide({
      grants: [grant('manager', 'm1', { scopeType: 'COMPANY', scopeId: otherCompany })],
    }),
  ).toEqual([]);
});

it('two grants of one user give one id, and the result is sorted', () => {
  expect(
    decide({
      grants: [grant('zeta', 'm1'), grant('zeta', 'm2'), grant('alpha', 'm3')],
    }),
  ).toEqual(['alpha', 'zeta']);
});
