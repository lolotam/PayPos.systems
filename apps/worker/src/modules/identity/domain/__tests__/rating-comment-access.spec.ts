import { expect, it } from 'vitest';
import {
  decideRatingCommentReaders,
  type RatingCommentBranch,
  type RatingCommentGrant,
  type RatingCommentInput,
  type RatingCommentMembership,
} from '../rating-comment-access.ts';

const branch: RatingCommentBranch = {
  companyId: '01920000-0000-7000-8000-0000000000a0',
  businessId: '01920000-0000-7000-8000-0000000000a1',
  branchId: '01920000-0000-7000-8000-0000000000a2',
};
const otherBranch = '01920000-0000-7000-8000-0000000000b2';
const membership = (
  userId: string,
  membershipId: string,
  overrides: Partial<RatingCommentMembership> = {},
): RatingCommentMembership => ({ userId, membershipId, manager: true, covers: true, ...overrides });
const grant = (
  userId: string,
  membershipId: string,
  overrides: Partial<RatingCommentGrant> = {},
): RatingCommentGrant => ({
  userId,
  membershipId,
  effect: 'ALLOW',
  scopeType: 'BRANCH',
  scopeId: branch.branchId,
  ...overrides,
});
const decide = (input: Partial<RatingCommentInput> & Pick<RatingCommentInput, 'userIds'>) =>
  decideRatingCommentReaders({ branch, memberships: [], owners: [], grants: [], ...input });

it('a manager membership covering the branch whose role grants the permission is a reader', () => {
  expect(
    decide({
      userIds: ['manager'],
      memberships: [membership('manager', 'm1')],
      grants: [grant('manager', 'm1')],
    }),
  ).toEqual(['manager']);
});

it('a covering DENY on the same membership removes the user', () => {
  expect(
    decide({
      userIds: ['manager'],
      memberships: [membership('manager', 'm1')],
      grants: [
        grant('manager', 'm1'),
        grant('manager', 'm1', { effect: 'DENY', scopeType: 'COMPANY', scopeId: branch.companyId }),
      ],
    }),
  ).toEqual([]);
});

it('a covering DENY on a sibling non-manager membership removes the user', () => {
  expect(
    decide({
      userIds: ['manager'],
      memberships: [membership('manager', 'm1'), membership('manager', 'm2', { manager: false })],
      grants: [grant('manager', 'm1'), grant('manager', 'm2', { effect: 'DENY' })],
    }),
  ).toEqual([]);
});

it('a DENY that names another branch or another business does not cover this branch', () => {
  expect(
    decide({
      userIds: ['manager'],
      memberships: [membership('manager', 'm1')],
      grants: [
        grant('manager', 'm1', { scopeType: 'COMPANY', scopeId: branch.companyId }),
        grant('manager', 'm1', { effect: 'DENY', scopeId: otherBranch }),
        grant('manager', 'm1', { effect: 'DENY', scopeType: 'BUSINESS', scopeId: otherBranch }),
      ],
    }),
  ).toEqual(['manager']);
});

it('the canonical owner ignores a DENY but is not a reader without an ALLOW source', () => {
  const denied = grant('owner', 'm1', {
    effect: 'DENY',
    scopeType: 'COMPANY',
    scopeId: branch.companyId,
  });
  expect(
    decide({
      userIds: ['owner'],
      memberships: [membership('owner', 'm1')],
      owners: ['owner'],
      grants: [grant('owner', 'm1'), denied],
    }),
  ).toEqual(['owner']);
  expect(
    decide({
      userIds: ['owner'],
      memberships: [membership('owner', 'm1')],
      owners: ['owner'],
      grants: [denied],
    }),
  ).toEqual([]);
});

it('a custom role or a non-manager role with an ALLOW is excluded', () => {
  expect(
    decide({
      userIds: ['custom', 'cashier'],
      memberships: [
        membership('custom', 'm1', { manager: false }),
        membership('cashier', 'm2', { manager: false }),
      ],
      grants: [grant('custom', 'm1'), grant('cashier', 'm2')],
    }),
  ).toEqual([]);
});

it('an ALLOW on a membership that does not cover the branch does not count', () => {
  expect(
    decide({
      userIds: ['manager'],
      memberships: [membership('manager', 'm1', { covers: false })],
      grants: [grant('manager', 'm1')],
    }),
  ).toEqual([]);
});

it('only candidates are returned, sorted and unique', () => {
  expect(
    decide({
      userIds: ['b', 'a', 'b'],
      memberships: [membership('a', 'm1'), membership('b', 'm2'), membership('c', 'm3')],
      grants: [grant('a', 'm1'), grant('b', 'm2'), grant('c', 'm3')],
    }),
  ).toEqual(['a', 'b']);
});
