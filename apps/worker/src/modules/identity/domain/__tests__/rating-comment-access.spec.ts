import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  decideRatingCommentReaders,
  type RatingCommentBranch,
  type RatingCommentGrant,
  type RatingCommentInput,
  type RatingCommentMembership,
} from '../rating-comment-access.ts';
import { RULE_CASES } from './ratings-comment-rule-cases.ts';

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

/** مصفوفة بتعدّ كل مرة الدالة بتمشي عليها، بأي طريقة، عشان نثبت إن القرار مش بيعيد مسح المنح والعضويات لكل مستلم. */
class CountingArray<T> extends Array<T> {
  static scans = 0;
  static wrap<U>(items: readonly U[]): CountingArray<U> {
    const counted = new CountingArray<U>();
    for (const item of items) Array.prototype.push.call(counted, item);
    return counted;
  }
  override filter(...args: Parameters<T[]['filter']>): T[] {
    CountingArray.scans += 1;
    return super.filter(...args);
  }
  override some(...args: Parameters<T[]['some']>): boolean {
    CountingArray.scans += 1;
    return super.some(...args);
  }
  override [Symbol.iterator](): ArrayIterator<T> {
    CountingArray.scans += 1;
    return super[Symbol.iterator]();
  }
}

it('scans the grants and memberships once, however many recipients there are, with the same answer', () => {
  const users = Array.from({ length: 300 }, (_, index) => `user-${String(index).padStart(3, '0')}`);
  const memberships = users.map((user) => membership(user, `m-${user}`));
  const grants = users.map((user) => grant(user, `m-${user}`));
  const denied = users[7] ?? '';
  grants.push(
    grant(denied, `m-${denied}`, {
      effect: 'DENY',
      scopeType: 'COMPANY',
      scopeId: branch.companyId,
    }),
  );
  CountingArray.scans = 0;
  const readers = decide({
    userIds: users,
    memberships: CountingArray.wrap(memberships),
    grants: CountingArray.wrap(grants),
  });
  expect(readers).toEqual(users.filter((user) => user !== denied));
  expect(CountingArray.scans).toBe(2);
});

/** بصمة الجدول المشترك؛ نفس القيمة بالحرف في spec الـ API، فتعديل جانب واحد يكسر الجانب التاني. */
const TABLE_FINGERPRINT = 'ede383d62237ee519593a30865c7c2b1159f345ced48ab10b80b1376ea47fa3b';
const MANAGER_ROLES = ['owner', 'general_manager', 'business_manager', 'branch_manager'];
const sharedBranches = { b1: 'b1', b2: 'b2' } as const;

it('the shared comment-reader rule table is the same one the API ratings read is tested against', () => {
  expect(createHash('sha256').update(JSON.stringify(RULE_CASES)).digest('hex')).toBe(
    TABLE_FINGERPRINT,
  );
});

it.each(RULE_CASES.map((c) => [c.name, c] as const))('shared rule table: %s', (_name, c) => {
  const covers = (scopeType: string, scopeId: string) =>
    (scopeType === 'COMPANY' && scopeId === 'C') ||
    (scopeType === 'BUSINESS' && scopeId === 'B') ||
    (scopeType === 'BRANCH' && scopeId === sharedBranches[c.branch]);
  const readers = decideRatingCommentReaders({
    branch: { companyId: 'C', businessId: 'B', branchId: sharedBranches[c.branch] },
    userIds: ['u'],
    memberships: c.memberships.map((m) => ({
      userId: 'u',
      membershipId: m.id,
      manager: m.role !== null && MANAGER_ROLES.includes(m.role),
      covers: covers(m.scopeType, m.scopeId),
    })),
    owners: c.owner ? ['u'] : [],
    grants: c.grants.map((g) => ({
      userId: 'u',
      membershipId: g.membership,
      effect: g.effect,
      scopeType: g.scopeType,
      scopeId: g.scopeId,
    })),
  });
  expect(readers).toEqual(c.readable ? ['u'] : []);
});
