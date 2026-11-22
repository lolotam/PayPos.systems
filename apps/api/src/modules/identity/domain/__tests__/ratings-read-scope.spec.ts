import { describe, expect, it } from 'vitest';
import type { AccessGrant } from '../access.ts';
import { readableRatingBranches, type RatingsReadMembership } from '../ratings-read-scope.ts';
import { RATINGS_READ_PERMISSION } from '../ratings-read-eligibility.ts';

const scope = { companyId: 'company', businessId: 'business' };
const branches = ['b1', 'b2', 'b3'];
const grant = (
  scopeType: AccessGrant['scopeType'],
  scopeId: string,
  effect: AccessGrant['effect'] = 'ALLOW',
): AccessGrant => ({ permission: RATINGS_READ_PERMISSION, effect, scopeType, scopeId });
const member = (
  scopeType: RatingsReadMembership['scopeType'],
  scopeId: string,
  systemRoleCode: string | null,
): RatingsReadMembership => ({ scopeType, scopeId, systemRoleCode });
const read = (members: RatingsReadMembership[], grants: AccessGrant[]) =>
  readableRatingBranches(scope, branches, members, grants);

describe('readableRatingBranches', () => {
  it('lets a branch manager read her own branch only', () => {
    expect(read([member('BRANCH', 'b2', 'branch_manager')], [grant('BRANCH', 'b2')])).toEqual([
      'b2',
    ]);
  });

  it.each([
    ['owner', 'COMPANY', 'company'],
    ['general_manager', 'COMPANY', 'company'],
    ['business_manager', 'BUSINESS', 'business'],
  ] as const)('lets a %s read every branch of the business', (role, type, id) => {
    expect(read([member(type, id, role)], [grant(type, id)])).toEqual(branches);
  });

  it('removes a branch denied at branch level while the business grant stays', () => {
    expect(
      read(
        [member('BUSINESS', 'business', 'business_manager')],
        [grant('BUSINESS', 'business'), grant('BRANCH', 'b2', 'DENY')],
      ),
    ).toEqual(['b1', 'b3']);
  });

  it('refuses a role changed to cashier even though the earlier grant is still effective', () => {
    expect(read([member('BRANCH', 'b1', 'cashier')], [grant('BRANCH', 'b1')])).toEqual([]);
  });

  it('refuses a custom role whose code looks like a manager role', () => {
    expect(read([member('COMPANY', 'company', null)], [grant('COMPANY', 'company')])).toEqual([]);
  });

  it('refuses a manager without an effective grant and a user without memberships', () => {
    expect(read([member('BRANCH', 'b1', 'branch_manager')], [])).toEqual([]);
    expect(read([], [grant('COMPANY', 'company')])).toEqual([]);
  });

  it('does not let a manager membership elsewhere widen a stale grant on a cashier membership', () => {
    expect(
      read(
        [member('BRANCH', 'b1', 'cashier'), member('BRANCH', 'b3', 'branch_manager')],
        [grant('BRANCH', 'b1'), grant('BRANCH', 'b3')],
      ),
    ).toEqual(['b3']);
  });

  it('answers nothing for a business without branches', () => {
    expect(
      readableRatingBranches(
        scope,
        [],
        [member('COMPANY', 'company', 'owner')],
        [grant('COMPANY', 'company')],
      ),
    ).toEqual([]);
  });
});
