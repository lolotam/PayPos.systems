import { expect, it } from 'vitest';
import {
  decideDiscountApprovers,
  type DiscountApproverBranch,
  type DiscountApproverGrant,
  type DiscountApproverInput,
  type DiscountApproverMembership,
} from '../discount-approver-access.ts';

const branch: DiscountApproverBranch = {
  companyId: '01920000-0000-7000-8000-0000000000a0',
  businessId: '01920000-0000-7000-8000-0000000000a1',
  branchId: '01920000-0000-7000-8000-0000000000a2',
};
const otherBranch = '01920000-0000-7000-8000-0000000000b2';
const membership = (
  userId: string,
  membershipId: string,
  covers = true,
): DiscountApproverMembership => ({ userId, membershipId, covers });
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
  decideDiscountApprovers({ branch, memberships: [], owners: [], grants: [], ...input });

it('a covering membership whose role grants the permission is a recipient', () => {
  expect(
    decide({
      memberships: [membership('manager', 'm1')],
      grants: [grant('manager', 'm1', { scopeType: 'BRANCH' })],
    }),
  ).toEqual(['manager']);
});

it('a cashier granted the permission by name is a recipient', () => {
  expect(
    decide({
      memberships: [membership('cashier', 'm1')],
      grants: [grant('cashier', 'm1')],
    }),
  ).toEqual(['cashier']);
});

it('a covering membership without the permission is not a recipient', () => {
  expect(decide({ memberships: [membership('cashier', 'm1')] })).toEqual([]);
});

it('a DENY on the covering membership excludes the holder', () => {
  expect(
    decide({
      memberships: [membership('manager', 'm1')],
      grants: [grant('manager', 'm1'), grant('manager', 'm1', { effect: 'DENY' })],
    }),
  ).toEqual([]);
});

it('a DENY on a membership that does not cover the branch still excludes when its own scope covers it', () => {
  expect(
    decide({
      memberships: [membership('manager', 'm1'), membership('manager', 'm2', false)],
      grants: [grant('manager', 'm1'), grant('manager', 'm2', { effect: 'DENY' })],
    }),
  ).toEqual([]);
});

it('a DENY at another branch does not exclude', () => {
  expect(
    decide({
      memberships: [membership('manager', 'm1')],
      grants: [
        grant('manager', 'm1'),
        grant('manager', 'm1', { effect: 'DENY', scopeId: otherBranch }),
      ],
    }),
  ).toEqual(['manager']);
});

it('an owner ignores every DENY', () => {
  expect(
    decide({
      memberships: [membership('owner', 'm1')],
      owners: ['owner'],
      grants: [grant('owner', 'm1'), grant('owner', 'm1', { effect: 'DENY' })],
    }),
  ).toEqual(['owner']);
});

it('a holder only at another branch is excluded', () => {
  expect(
    decide({
      memberships: [membership('manager', 'm1', false)],
      grants: [grant('manager', 'm1', { scopeId: otherBranch })],
    }),
  ).toEqual([]);
});

it('an override allowed at another branch does not count', () => {
  expect(
    decide({
      memberships: [membership('cashier', 'm1')],
      grants: [grant('cashier', 'm1', { scopeId: otherBranch })],
    }),
  ).toEqual([]);
});

it('a business-wide grant covers the branch of that business only', () => {
  expect(
    decide({
      memberships: [membership('manager', 'm1')],
      grants: [grant('manager', 'm1', { scopeType: 'BUSINESS', scopeId: branch.businessId })],
    }),
  ).toEqual(['manager']);
  expect(
    decide({
      memberships: [membership('manager', 'm1')],
      grants: [
        grant('manager', 'm1', {
          scopeType: 'BUSINESS',
          scopeId: '01920000-0000-7000-8000-0000000000b1',
        }),
      ],
    }),
  ).toEqual([]);
});

it('a company-wide grant covers the branch, and another company does not', () => {
  expect(
    decide({
      memberships: [membership('manager', 'm1')],
      grants: [grant('manager', 'm1', { scopeType: 'COMPANY', scopeId: branch.companyId })],
    }),
  ).toEqual(['manager']);
  expect(
    decide({
      memberships: [membership('manager', 'm1')],
      grants: [
        grant('manager', 'm1', {
          scopeType: 'COMPANY',
          scopeId: '01920000-0000-7000-8000-0000000000b0',
        }),
      ],
    }),
  ).toEqual([]);
});

it('two memberships of one user give one id, and the result is sorted', () => {
  expect(
    decide({
      memberships: [membership('zeta', 'm1'), membership('zeta', 'm2'), membership('alpha', 'm3')],
      grants: [grant('zeta', 'm1'), grant('zeta', 'm2'), grant('alpha', 'm3')],
    }),
  ).toEqual(['alpha', 'zeta']);
});
