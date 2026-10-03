import { expect, it } from 'vitest';
import {
  permissionEditFailure,
  type PermissionEditContext,
  type OverrideTerms,
} from '../permission-edit.ts';
import type { AccessGrant } from '../access.ts';

const companyId = 'company',
  businessId = 'business',
  branchId = 'branch';
const grant = (permission: string): AccessGrant => ({
  permission,
  effect: 'ALLOW',
  scopeType: 'BUSINESS',
  scopeId: businessId,
});
const terms: OverrideTerms = {
  permission_code: 'read:settings:business',
  effect: 'ALLOW',
  scope_type: 'BUSINESS',
  scope_id: businessId,
  reason: 'Synthetic scoped decision',
  expires_at: null,
};
const member = {
  id: 'member',
  userId: 'other',
  employeeId: null,
  roleCode: 'viewer',
  scopeType: 'BUSINESS' as const,
  scopeId: businessId,
  startsAt: new Date('2020-01-01'),
  endsAt: null,
};
const context: PermissionEditContext = {
  companyId,
  editorUserId: 'editor',
  now: new Date('2026-10-03T12:00:00Z'),
  membership: member,
  holderMemberships: [member],
  catalog: [terms.permission_code],
  target: { companyId, businessId },
  membershipTarget: { companyId, businessId },
  managementBusinessId: businessId,
  descendantTargets: [{ companyId, businessId, branchId }],
  grants: [grant('manage:memberships:business'), grant(terms.permission_code)],
};

it.each(['SAVE', 'REVOKE'] as const)(
  'permits explicit business management for a scoped %s',
  (operation) => {
    expect(permissionEditFailure(terms, context, operation)).toBeNull();
  },
);
it.each(['target', 'membershipTarget'] as const)('refuses company/other-business %s', (field) => {
  for (const target of [{ companyId }, { companyId, businessId: 'other' }, null])
    expect(permissionEditFailure(terms, { ...context, [field]: target })).toBe('FORBIDDEN');
});
it('business management never authorizes a company command or an optional permission by default', () => {
  expect(permissionEditFailure(terms, { ...context, managementBusinessId: undefined })).toBe(
    'FORBIDDEN',
  );
  expect(permissionEditFailure(terms, { ...context, grants: [grant(terms.permission_code)] })).toBe(
    'FORBIDDEN',
  );
});
it('requires management on every affected branch and effective possession of the delegated permission', () => {
  const denied: AccessGrant = {
    ...grant('manage:memberships:business'),
    effect: 'DENY',
    scopeType: 'BRANCH',
    scopeId: branchId,
  };
  expect(permissionEditFailure(terms, { ...context, grants: [...context.grants, denied] })).toBe(
    'FORBIDDEN',
  );
  expect(
    permissionEditFailure(terms, { ...context, grants: [grant('manage:memberships:business')] }),
  ).toBe('PERMISSION_NOT_HELD');
});

it.each(['read:memberships:business', 'manage:memberships:business'])(
  'confines explicit %s for a business manager even through company management',
  (permission_code) => {
    const scoped = { ...terms, permission_code };
    const companyContext: PermissionEditContext = {
      ...context,
      managementBusinessId: undefined,
      membership: { ...member, roleCode: 'business_manager' },
      catalog: [permission_code],
      grants: ['manage:memberships:company', permission_code].map((permission) => ({
        permission,
        effect: 'ALLOW',
        scopeType: 'COMPANY',
        scopeId: companyId,
      })),
    };
    expect(permissionEditFailure(scoped, companyContext)).toBeNull();
    for (const target of [{ companyId }, { companyId, businessId: 'other' }])
      expect(permissionEditFailure(scoped, { ...companyContext, target })).toBe(
        'PERMISSION_SCOPE_OUTSIDE_REACH',
      );
  },
);
