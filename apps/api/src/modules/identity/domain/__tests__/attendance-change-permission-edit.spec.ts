import { expect, it } from 'vitest';
import {
  permissionEditFailure,
  type PermissionEditContext,
  type OverrideTerms,
} from '../permission-edit.ts';

const permission = 'decide:attendance-change:company';
const request = 'request:attendance-change:branch';
const terms: OverrideTerms = {
  permission_code: permission,
  effect: 'ALLOW',
  scope_type: 'COMPANY',
  scope_id: 'company',
  reason: 'synthetic',
  expires_at: null,
};
const context: PermissionEditContext = {
  companyId: 'company',
  editorUserId: 'editor',
  editorIsCompanyOwner: false,
  now: new Date('2026-10-10'),
  catalog: [permission, request],
  target: { companyId: 'company' },
  descendantTargets: [],
  holderMemberships: [],
  membership: {
    id: 'member',
    userId: 'target',
    employeeId: null,
    roleCode: 'general_manager',
    systemRoleCode: 'general_manager',
    allowedPermissions: [permission, request],
    isCompanyOwner: false,
    scopeType: 'COMPANY',
    scopeId: 'company',
    startsAt: new Date('2026-01-01'),
    endsAt: null,
  },
  grants: [permission, request, 'manage:memberships:company'].map((code) => ({
    permission: code,
    effect: 'ALLOW',
    scopeType: 'COMPANY',
    scopeId: 'company',
  })),
};

it.each([
  ['SAVE', permission],
  ['REVOKE', permission],
  ['SAVE', request],
  ['REVOKE', request],
] as const)('only an owner may %s an override of %s', (operation, code) => {
  for (const effect of ['ALLOW', 'DENY'] as const) {
    const edit = { ...terms, permission_code: code, effect };
    expect(permissionEditFailure(edit, context, operation)).toBe('PERMISSION_OWNER_ONLY');
    expect(
      permissionEditFailure(edit, { ...context, editorIsCompanyOwner: true }, operation),
    ).toBeNull();
  }
});
