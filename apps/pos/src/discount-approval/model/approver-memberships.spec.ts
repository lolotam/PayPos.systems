import { t } from '@pospay/i18n';
import { describe, expect, it } from 'vitest';

import { approverMembershipLabel, readApproverMemberships } from './approver-memberships';

const m1 = '01923f66-3d2b-7c00-8000-000000000101';
const m2 = '01923f66-3d2b-7c00-8000-000000000102';
const details = {
  approver_membership_ids: [m1, m2],
  approver_memberships: [
    {
      membership_id: m1,
      scope_type: 'BUSINESS',
      scope_id: '01923f66-3d2b-7c00-8000-000000000201',
      role: {
        code: 'business_manager',
        is_system: true,
        name_ar: null,
        name_en: 'Business manager',
      },
    },
    {
      membership_id: m2,
      scope_type: 'BRANCH',
      scope_id: '01923f66-3d2b-7c00-8000-000000000202',
      role: { code: 'custom_x', is_system: false, name_ar: 'Custom AR', name_en: 'Custom' },
    },
  ],
};

describe('readApproverMemberships', () => {
  it('reads usable memberships and drops unreadable role fields', () => {
    expect(readApproverMemberships(details)).toEqual([
      {
        membershipId: m1,
        scopeType: 'BUSINESS',
        role: { code: 'business_manager', nameAr: null, nameEn: 'Business manager' },
      },
      {
        membershipId: m2,
        scopeType: 'BRANCH',
        role: { code: 'custom_x', nameAr: 'Custom AR', nameEn: 'Custom' },
      },
    ]);
  });

  it.each([null, 'bad', {}, { approver_memberships: [] }, { approver_memberships: [{}] }])(
    'returns null for unreadable input %#',
    (input) => {
      expect(readApproverMemberships(input)).toBeNull();
    },
  );

  it('keeps an entry with a broken role as a numbered fallback', () => {
    const input = {
      approver_memberships: [{ membership_id: m1, scope_type: 'COMPANY', role: { code: m1 } }],
    };
    expect(readApproverMemberships(input)).toEqual([
      { membershipId: m1, scopeType: 'COMPANY', role: null },
    ]);
  });
});

describe('approverMembershipLabel', () => {
  it('labels system and custom roles with their scopes in both locales', () => {
    const memberships = readApproverMemberships(details);
    const [business, custom] = memberships ?? [];
    if (!business || !custom) throw new Error('membership fixture unreadable');
    expect(approverMembershipLabel('ar', business, 0)).toBe(
      `${t('ar', 'roles.business_manager')} — ${t('ar', 'deviceDiscountApproval.scopeBusiness')}`,
    );
    expect(approverMembershipLabel('ar', custom, 1)).toBe(
      `Custom AR — ${t('ar', 'deviceDiscountApproval.scopeBranch')}`,
    );
    expect(approverMembershipLabel('en', custom, 1)).toBe(
      `Custom — ${t('en', 'deviceDiscountApproval.scopeBranch')}`,
    );
  });

  it('uses the one-based numbered label when the role is unreadable', () => {
    const label = approverMembershipLabel(
      'ar',
      { membershipId: m2, scopeType: 'BRANCH', role: null },
      1,
    );
    expect(label).toBe(t('ar', 'deviceDiscountApproval.membershipN').replace('{n}', '2'));
  });
});
