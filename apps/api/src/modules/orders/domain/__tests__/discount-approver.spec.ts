import { describe, expect, it } from 'vitest';
import {
  resolveDiscountApprover,
  type DiscountApproverAccess,
  type DiscountApproverMembership,
} from '../discount-approver.ts';

const MANAGER_ROLE = { code: 'branch_manager', is_system: true, name_ar: 'مدير فرع', name_en: 'Branch Manager' };
const BUSINESS_ROLE = { code: 'business_manager', is_system: true, name_ar: 'مدير نشاط', name_en: 'Business Manager' };

const MEMBERSHIP_1: DiscountApproverMembership = {
  membership_id: 'mem-branch-manager',
  scope_type: 'BRANCH',
  scope_id: 'branch-1',
  role: MANAGER_ROLE,
};
const MEMBERSHIP_2: DiscountApproverMembership = {
  membership_id: 'mem-business-manager',
  scope_type: 'BUSINESS',
  scope_id: 'business-1',
  role: BUSINESS_ROLE,
};

function access(overrides: Partial<DiscountApproverAccess> = {}): DiscountApproverAccess {
  return { denied: false, feature: true, eligible: [MEMBERSHIP_1], ...overrides };
}

describe('resolveDiscountApprover refusals', () => {
  it.each([
    ['denied access is forbidden', { denied: true }, undefined, 'FORBIDDEN'],
    ['no eligible membership is forbidden', { eligible: [] }, undefined, 'FORBIDDEN'],
    ['orders feature off is disabled', { feature: false }, undefined, 'FEATURE_DISABLED'],
    ['supplied membership outside the eligible list is forbidden', {}, 'mem-foreign', 'FORBIDDEN'],
  ] as const)('%s', (_scenario, overrides: Partial<DiscountApproverAccess>, selected, code) => {
    expect(() => resolveDiscountApprover(access(overrides), selected))
      .toThrowError(expect.objectContaining({ code }));
  });
});

describe('resolveDiscountApprover selection', () => {
  it('returns single eligible membership when selection is omitted', () => {
    expect(resolveDiscountApprover(access(), undefined)).toEqual(MEMBERSHIP_1);
  });

  it('returns supplied membership when it is eligible', () => {
    const resolved = resolveDiscountApprover(access({ eligible: [MEMBERSHIP_1, MEMBERSHIP_2] }), 'mem-business-manager');
    expect(resolved).toEqual(MEMBERSHIP_2);
  });

  it('throws DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED with all eligible ids and roles when multiple eligible and none supplied', () => {
    expect(() => resolveDiscountApprover(access({ eligible: [MEMBERSHIP_1, MEMBERSHIP_2] }), undefined))
      .toThrowError(expect.objectContaining({
        code: 'DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED',
        details: {
          approver_membership_ids: ['mem-branch-manager', 'mem-business-manager'],
          approver_memberships: [
            {
              membership_id: 'mem-branch-manager',
              scope_type: 'BRANCH',
              scope_id: 'branch-1',
              role: MANAGER_ROLE,
            },
            {
              membership_id: 'mem-business-manager',
              scope_type: 'BUSINESS',
              scope_id: 'business-1',
              role: BUSINESS_ROLE,
            },
          ],
        },
      }));
  });
});

describe('resolveDiscountApprover scope labels', () => {
  /** تمييز العضويات ذات الدور المتطابق بنطاقها لتمكين المستخدم من الاختيار عند تعدد نطاقات الصلاحية. */
  it('distinguishes memberships with the same role by scope when requiring selection', () => {
    const businessManager: DiscountApproverMembership = {
      membership_id: 'mem-business-1',
      scope_type: 'BUSINESS',
      scope_id: 'business-1',
      role: MANAGER_ROLE,
    };
    const branchManager: DiscountApproverMembership = {
      membership_id: 'mem-branch-1',
      scope_type: 'BRANCH',
      scope_id: 'branch-1',
      role: MANAGER_ROLE,
    };
    expect(() => resolveDiscountApprover(access({ eligible: [businessManager, branchManager] }), undefined))
      .toThrowError(expect.objectContaining({
        code: 'DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED',
        details: {
          approver_membership_ids: ['mem-business-1', 'mem-branch-1'],
          approver_memberships: [
            {
              membership_id: 'mem-business-1',
              scope_type: 'BUSINESS',
              scope_id: 'business-1',
              role: MANAGER_ROLE,
            },
            {
              membership_id: 'mem-branch-1',
              scope_type: 'BRANCH',
              scope_id: 'branch-1',
              role: MANAGER_ROLE,
            },
          ],
        },
      }));
  });
});
