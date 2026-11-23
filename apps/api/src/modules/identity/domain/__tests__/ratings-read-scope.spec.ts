import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RATINGS_READ_ROLES } from '../ratings-read-eligibility.ts';
import {
  readableRatingBranches,
  type RatingsReadGrant,
  type RatingsReadMembership,
} from '../ratings-read-scope.ts';
import { RULE_CASES } from './ratings-comment-rule-cases.ts';

const scope = { companyId: 'C', businessId: 'B' };
const branches = ['b1', 'b2', 'b3'];
const grant = (
  membershipId: string,
  scopeType: RatingsReadGrant['scopeType'],
  scopeId: string,
  effect: RatingsReadGrant['effect'] = 'ALLOW',
): RatingsReadGrant => ({ membershipId, effect, scopeType, scopeId });
const member = (
  membershipId: string,
  scopeType: RatingsReadMembership['scopeType'],
  scopeId: string,
  systemRoleCode: string | null,
): RatingsReadMembership => ({ membershipId, scopeType, scopeId, systemRoleCode });
const read = (members: RatingsReadMembership[], grants: RatingsReadGrant[], owner = false) =>
  readableRatingBranches(scope, branches, members, grants, owner);

/** بصمة الجدول المشترك؛ نفس القيمة بالحرف في spec الـ worker، فتعديل جانب واحد يكسر الجانب التاني. */
const TABLE_FINGERPRINT = 'ede383d62237ee519593a30865c7c2b1159f345ced48ab10b80b1376ea47fa3b';

describe('the shared comment-reader rule table', () => {
  it('is the same table the worker decision is tested against', () => {
    expect(createHash('sha256').update(JSON.stringify(RULE_CASES)).digest('hex')).toBe(
      TABLE_FINGERPRINT,
    );
  });

  it.each(RULE_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const answer = readableRatingBranches(
      scope,
      [c.branch],
      c.memberships.map((m) => member(m.id, m.scopeType, m.scopeId, m.role)),
      c.grants.map((g) => grant(g.membership, g.scopeType, g.scopeId, g.effect)),
      c.owner,
    );
    expect(answer).toEqual(c.readable ? [c.branch] : []);
  });

  it('uses the same four manager roles as the eligibility rule', () => {
    expect([...RATINGS_READ_ROLES].sort()).toEqual([
      'branch_manager',
      'business_manager',
      'general_manager',
      'owner',
    ]);
  });
});

describe('readableRatingBranches over several branches', () => {
  it('lets a branch manager read her own branch only', () => {
    expect(
      read([member('m1', 'BRANCH', 'b2', 'branch_manager')], [grant('m1', 'BRANCH', 'b2')]),
    ).toEqual(['b2']);
  });

  it.each([
    ['owner', 'COMPANY', 'C'],
    ['general_manager', 'COMPANY', 'C'],
    ['business_manager', 'BUSINESS', 'B'],
  ] as const)('lets a %s read every branch of the business', (role, type, id) => {
    expect(read([member('m1', type, id, role)], [grant('m1', type, id)])).toEqual(branches);
  });

  it('removes a branch denied at branch level while the business grant stays', () => {
    expect(
      read(
        [member('m1', 'BUSINESS', 'B', 'business_manager')],
        [grant('m1', 'BUSINESS', 'B'), grant('m1', 'BRANCH', 'b2', 'DENY')],
      ),
    ).toEqual(['b1', 'b3']);
  });

  it('does not let a manager membership elsewhere widen a stale grant on a cashier membership', () => {
    expect(
      read(
        [member('m1', 'BRANCH', 'b1', 'cashier'), member('m2', 'BRANCH', 'b3', 'branch_manager')],
        [grant('m1', 'BRANCH', 'b1'), grant('m2', 'BRANCH', 'b3')],
      ),
    ).toEqual(['b3']);
  });

  it('answers nothing for a business without branches', () => {
    expect(
      readableRatingBranches(
        scope,
        [],
        [member('m1', 'COMPANY', 'C', 'owner')],
        [grant('m1', 'COMPANY', 'C')],
        true,
      ),
    ).toEqual([]);
  });
});
