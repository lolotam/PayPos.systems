import { expect, it } from 'vitest';
import {
  permissionEditFailure,
  type PermissionEditContext,
  type OverrideTerms,
} from '../permission-edit.ts';

const permission = 'decide:attendance-change:company';
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
  catalog: [permission],
  target: { companyId: 'company' },
  descendantTargets: [],
  holderMemberships: [],
  membership: {
    id: 'member',
    userId: 'target',
    employeeId: null,
    roleCode: 'general_manager',
    systemRoleCode: 'general_manager',
    allowedPermissions: [permission],
    isCompanyOwner: false,
    scopeType: 'COMPANY',
    scopeId: 'company',
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

it.each(['SAVE', 'REVOKE'] as const)(
  'only an owner may %s an attendance decision grant',
  (operation) => {
    for (const effect of ['ALLOW', 'DENY'] as const) {
      expect(permissionEditFailure({ ...terms, effect }, context, operation)).toBe(
        'PERMISSION_OWNER_ONLY',
      );
      expect(
        permissionEditFailure(
          { ...terms, effect },
          { ...context, editorIsCompanyOwner: true },
          operation,
        ),
      ).toBeNull();
    }
  },
);
