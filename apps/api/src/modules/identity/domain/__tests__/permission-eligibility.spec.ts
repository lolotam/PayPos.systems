import { expect, it } from 'vitest';
import {
  permissionEditFailure,
  permissionHolderIsOwner,
  type PermissionEditContext,
} from '../permission-edit.ts';

const companyId = 'company';
const terms = {
  permission_code: 'manage:devices:branch',
  effect: 'ALLOW' as const,
  scope_type: 'COMPANY' as const,
  scope_id: companyId,
  reason: 'Synthetic role eligibility',
  expires_at: null,
};
const context: PermissionEditContext = {
  companyId,
  editorUserId: 'editor',
  now: new Date('2026-10-03'),
  catalog: [terms.permission_code],
  holderMemberships: [],
  target: { companyId },
  descendantTargets: [],
  membership: {
    id: 'member',
    userId: 'holder',
    employeeId: null,
    roleCode: 'viewer',
    systemRoleCode: 'viewer',
    allowedPermissions: ['read:branches:branch'],
    isCompanyOwner: false,
    scopeType: 'COMPANY',
    scopeId: companyId,
    startsAt: new Date('2020-01-01'),
    endsAt: null,
  },
  grants: ['manage:memberships:company', terms.permission_code].map((permission) => ({
    permission,
    effect: 'ALLOW',
    scopeType: 'COMPANY',
    scopeId: companyId,
  })),
};
it('refuses forbidden ALLOW; DENY, revoke and numeric discount checks do not grant access', () => {
  expect(permissionEditFailure(terms, context)).toBe('PERMISSION_ROLE_FORBIDDEN');
  expect(permissionEditFailure({ ...terms, effect: 'DENY' }, context)).toBeNull();
  expect(permissionEditFailure(terms, context, 'REVOKE')).toBeNull();
  expect(permissionEditFailure(terms, context, 'CHECK')).toBeNull();
});
it('accepts default and optional cells and preserves custom-role policy despite a colliding owner name', () => {
  if (context.membership === null) throw new Error('Synthetic membership missing');
  const member = context.membership;
  expect(
    permissionEditFailure(terms, {
      ...context,
      membership: { ...member, allowedPermissions: [terms.permission_code] },
    }),
  ).toBeNull();
  const custom = {
    ...context,
    membership: { ...member, roleCode: 'owner', systemRoleCode: null, allowedPermissions: null },
  };
  expect(permissionEditFailure(terms, custom)).toBeNull();
  expect(permissionHolderIsOwner(custom)).toBe(false);
});
