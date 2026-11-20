import { expect, it } from 'vitest';
import {
  permissionEditFailure,
  permissionHolderIsOwner,
  type PermissionEditContext,
} from '../permission-edit.ts';
import { RATINGS_READ_PERMISSION } from '../ratings-read-eligibility.ts';

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
  editorIsCompanyOwner: false,
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

it('confines the ratings-read ALLOW to the membership own scope (FR-B15)', () => {
  const ratingsTerms = { ...terms, permission_code: RATINGS_READ_PERMISSION };
  const branch = scopedMembership('branch_manager', 'BRANCH', 'branch-1');
  expect(
    permissionEditFailure({ ...ratingsTerms, scope_type: 'BRANCH', scope_id: 'branch-1' }, branch),
  ).toBeNull();
  expect(
    permissionEditFailure({ ...ratingsTerms, scope_type: 'BRANCH', scope_id: 'branch-2' }, branch),
  ).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
  expect(
    permissionEditFailure(
      { ...ratingsTerms, scope_type: 'BUSINESS', scope_id: 'business-1' },
      branch,
    ),
  ).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
  expect(permissionEditFailure(ratingsTerms, branch)).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
  const business = scopedMembership('business_manager', 'BUSINESS', 'business-1');
  expect(
    permissionEditFailure(
      { ...ratingsTerms, scope_type: 'BUSINESS', scope_id: 'business-1' },
      business,
    ),
  ).toBeNull();
  expect(permissionEditFailure(ratingsTerms, business)).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
  expect(
    permissionEditFailure(ratingsTerms, scopedMembership('owner', 'COMPANY', companyId)),
  ).toBeNull();
  expect(
    permissionEditFailure({ ...ratingsTerms, effect: 'DENY' }, branch),
  ).toBeNull();
});

function scopedMembership(
  systemRoleCode: string,
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
  scopeId: string,
): PermissionEditContext {
  if (context.membership === null) throw new Error('Synthetic membership missing');
  return {
    ...context,
    catalog: [RATINGS_READ_PERMISSION],
    grants: ['manage:memberships:company', RATINGS_READ_PERMISSION].map((permission) => ({
      permission,
      effect: 'ALLOW' as const,
      scopeType: 'COMPANY' as const,
      scopeId: companyId,
    })),
    membership: {
      ...context.membership,
      roleCode: systemRoleCode,
      systemRoleCode,
      allowedPermissions: [RATINGS_READ_PERMISSION],
      scopeType,
      scopeId,
    },
  };
}
