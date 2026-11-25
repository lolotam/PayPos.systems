import { describe, expect, it } from 'vitest';

import {
  COMMISSION_READ_PERMISSION,
  decideBusinessWideCommissionActors,
  isBusinessWideCommissionActor,
  type CommissionAccessGrant,
  type CommissionActionPermission,
} from '../commission-statement-access.js';

const COMPANY_ID = 'company-1';
const BUSINESS_ID = 'business-1';
const BRANCH_ID = 'branch-1';
const OTHER_BRANCH_ID = 'branch-2';

const allow = (
  permission: string,
  scopeType: CommissionAccessGrant['scopeType'],
  scopeId: string,
): CommissionAccessGrant => ({ permission, effect: 'ALLOW', scopeType, scopeId });

const deny = (
  permission: string,
  scopeType: CommissionAccessGrant['scopeType'],
  scopeId: string,
): CommissionAccessGrant => ({ permission, effect: 'DENY', scopeType, scopeId });

const actor = (
  grants: readonly CommissionAccessGrant[],
  actionPermission: CommissionActionPermission = 'approve:commissions:business',
  isCanonicalOwner?: boolean,
) => ({
  companyId: COMPANY_ID,
  businessId: BUSINESS_ID,
  businessBranchIds: [BRANCH_ID, OTHER_BRANCH_ID],
  actionPermission,
  grants,
  ...(isCanonicalOwner === undefined ? {} : { isCanonicalOwner }),
});

describe('isBusinessWideCommissionActor — grants and scopes', () => {
  it('grants the action on the business with a business-wide read', () => {
    expect(
      isBusinessWideCommissionActor(
        actor([
          allow('approve:commissions:business', 'BUSINESS', BUSINESS_ID),
          allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
        ]),
      ),
    ).toBe(true);
  });

  it('refuses a branch-scoped action grant: a branch scope never covers a business', () => {
    expect(
      isBusinessWideCommissionActor(
        actor([
          allow('approve:commissions:business', 'BRANCH', BRANCH_ID),
          allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
        ]),
      ),
    ).toBe(false);
  });

  it('refuses a branch-scoped read even with the action granted', () => {
    expect(
      isBusinessWideCommissionActor(
        actor([
          allow('approve:commissions:business', 'COMPANY', COMPANY_ID),
          allow(COMMISSION_READ_PERMISSION, 'BRANCH', BRANCH_ID),
        ]),
      ),
    ).toBe(false);
  });

  it('refuses a read denied on one branch of the business', () => {
    expect(
      isBusinessWideCommissionActor(
        actor([
          allow('approve:commissions:business', 'COMPANY', COMPANY_ID),
          allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
          deny(COMMISSION_READ_PERMISSION, 'BRANCH', OTHER_BRANCH_ID),
        ]),
      ),
    ).toBe(false);
  });

  it('ignores a denial on a branch of another business', () => {
    expect(
      isBusinessWideCommissionActor(
        actor([
          allow('approve:commissions:business', 'COMPANY', COMPANY_ID),
          allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
          deny(COMMISSION_READ_PERMISSION, 'BRANCH', 'branch-of-another-business'),
        ]),
      ),
    ).toBe(true);
  });

});

describe('isBusinessWideCommissionActor — owner, denials and review', () => {
  it('keeps the canonical owner business-wide despite a read denial', () => {
    expect(
      isBusinessWideCommissionActor(
        actor(
          [
            allow('approve:commissions:business', 'COMPANY', COMPANY_ID),
            allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
            deny(COMMISSION_READ_PERMISSION, 'BRANCH', BRANCH_ID),
          ],
          'approve:commissions:business',
          true,
        ),
      ),
    ).toBe(true);
  });

  it('keeps the canonical owner eligible despite a denial on the action itself', () => {
    expect(
      isBusinessWideCommissionActor(
        actor(
          [
            allow('approve:commissions:business', 'COMPANY', COMPANY_ID),
            deny('approve:commissions:business', 'COMPANY', COMPANY_ID),
            allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
          ],
          'approve:commissions:business',
          true,
        ),
      ),
    ).toBe(true);
  });

  it('refuses when the action permission itself is denied on the business', () => {
    expect(
      isBusinessWideCommissionActor(
        actor([
          allow('approve:commissions:business', 'COMPANY', COMPANY_ID),
          deny('approve:commissions:business', 'BUSINESS', BUSINESS_ID),
          allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
        ]),
      ),
    ).toBe(false);
  });

});

describe('isBusinessWideCommissionActor — review versus approve', () => {
  it('refuses a review-only holder when the approve action is required', () => {
    expect(
      isBusinessWideCommissionActor(
        actor([
          allow('review:commissions:business', 'COMPANY', COMPANY_ID),
          allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
        ]),
      ),
    ).toBe(false);
  });

  it('grants a review-only holder when the review action is required', () => {
    expect(
      isBusinessWideCommissionActor(
        actor(
          [
            allow('review:commissions:business', 'COMPANY', COMPANY_ID),
            allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
          ],
          'review:commissions:business',
        ),
      ),
    ).toBe(true);
  });

  it('refuses without any read grant at all', () => {
    expect(
      isBusinessWideCommissionActor(
        actor([allow('approve:commissions:business', 'COMPANY', COMPANY_ID)]),
      ),
    ).toBe(false);
  });
});

describe('decideBusinessWideCommissionActors', () => {
  it('keeps the owner and a business manager without a denial, and drops the rest', () => {
    const members = [
      {
        userId: 'user-owner',
        grants: [
          allow('approve:commissions:business', 'COMPANY', COMPANY_ID),
          allow('review:commissions:business', 'COMPANY', COMPANY_ID),
          allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
        ],
        isCanonicalOwner: true,
      },
      {
        userId: 'user-business-manager',
        grants: [
          allow('approve:commissions:business', 'BUSINESS', BUSINESS_ID),
          allow(COMMISSION_READ_PERMISSION, 'BUSINESS', BUSINESS_ID),
        ],
      },
      {
        userId: 'user-branch-manager',
        grants: [
          allow('approve:commissions:business', 'BUSINESS', BUSINESS_ID),
          allow(COMMISSION_READ_PERMISSION, 'BUSINESS', BUSINESS_ID),
          deny(COMMISSION_READ_PERMISSION, 'BRANCH', BRANCH_ID),
        ],
      },
      {
        userId: 'user-accountant',
        grants: [
          allow('review:commissions:business', 'COMPANY', COMPANY_ID),
          allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
          deny('approve:commissions:business', 'COMPANY', COMPANY_ID),
        ],
      },
    ];
    expect(
      decideBusinessWideCommissionActors({
        companyId: COMPANY_ID,
        businessId: BUSINESS_ID,
        businessBranchIds: [BRANCH_ID, OTHER_BRANCH_ID],
        actionPermission: 'approve:commissions:business',
        members,
      }),
    ).toEqual(['user-business-manager', 'user-owner']);
    expect(
      decideBusinessWideCommissionActors({
        companyId: COMPANY_ID,
        businessId: BUSINESS_ID,
        businessBranchIds: [BRANCH_ID, OTHER_BRANCH_ID],
        actionPermission: 'review:commissions:business',
        members,
      }),
    ).toEqual(['user-accountant', 'user-owner']);
  });

});

describe('decideBusinessWideCommissionActors — ordering', () => {
  it('drops duplicates and sorts ascending', () => {
    const grants = [
      allow('approve:commissions:business', 'COMPANY', COMPANY_ID),
      allow(COMMISSION_READ_PERMISSION, 'COMPANY', COMPANY_ID),
    ];
    expect(
      decideBusinessWideCommissionActors({
        companyId: COMPANY_ID,
        businessId: BUSINESS_ID,
        businessBranchIds: [],
        actionPermission: 'approve:commissions:business',
        members: [
          { userId: 'user-b', grants },
          { userId: 'user-a', grants },
          { userId: 'user-b', grants },
        ],
      }),
    ).toEqual(['user-a', 'user-b']);
  });
});
