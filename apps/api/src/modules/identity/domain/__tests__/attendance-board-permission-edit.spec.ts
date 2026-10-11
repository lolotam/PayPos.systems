import { expect, it } from 'vitest';
import {
  permissionEditFailure,
  type PermissionEditContext,
  type OverrideTerms,
} from '../permission-edit.ts';

const permission = 'read:attendance:branch';
const terms: OverrideTerms = {
  permission_code: permission,
  effect: 'ALLOW',
  scope_type: 'BRANCH',
  scope_id: 'branch',
  reason: 'synthetic',
  expires_at: null,
};
const context: PermissionEditContext = {
  companyId: 'company',
  editorUserId: 'editor',
  editorIsCompanyOwner: false,
  now: new Date('2026-10-11'),
  catalog: [permission],
  target: { companyId: 'company', businessId: 'business', branchId: 'branch' },
  descendantTargets: [],
  holderMemberships: [],
  membership: {
    id: 'member',
    userId: 'holder',
    employeeId: null,
    roleCode: 'staff',
    systemRoleCode: 'staff',
    allowedPermissions: [permission],
    isCompanyOwner: false,
    scopeType: 'BRANCH',
    scopeId: 'branch',
    startsAt: new Date('2026-01-01'),
    endsAt: null,
  },
  grants: [permission, 'manage:memberships:company'].map((code) => ({
    permission: code,
    effect: 'ALLOW',
    scopeType: 'COMPANY',
    scopeId: 'company',
  })),
};
it('AB-Q2 permits a personal attendance read grant only from the owner', () => {
  expect(permissionEditFailure(terms, context)).toBe('PERMISSION_OWNER_ONLY');
  expect(permissionEditFailure(terms, { ...context, editorIsCompanyOwner: true })).toBeNull();
});
