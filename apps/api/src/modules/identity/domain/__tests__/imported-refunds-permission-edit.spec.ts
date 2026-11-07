import { expect, it } from 'vitest';
import {
  permissionEditFailure,
  type PermissionEditContext,
  type OverrideTerms,
} from '../permission-edit.ts';

const code = 'manage:imported-refunds:business';
const terms: OverrideTerms = {
  permission_code: code,
  effect: 'ALLOW',
  scope_type: 'BUSINESS',
  scope_id: 'business',
  reason: 'Synthetic imported refund policy',
  expires_at: null,
};
const context: PermissionEditContext = {
  companyId: 'company',
  editorUserId: 'editor',
  editorIsCompanyOwner: false,
  now: new Date('2026-11-07'),
  catalog: [code],
  target: { companyId: 'company', businessId: 'business' },
  descendantTargets: [],
  membershipTarget: { companyId: 'company', businessId: 'business' },
  holderMemberships: [],
  membership: {
    id: 'member',
    userId: 'target',
    employeeId: null,
    roleCode: 'staff',
    systemRoleCode: 'staff',
    allowedPermissions: [code],
    isCompanyOwner: false,
    scopeType: 'BUSINESS',
    scopeId: 'business',
    startsAt: new Date('2026-01-01'),
    endsAt: null,
  },
  grants: [code, 'manage:memberships:company', 'manage:memberships:business'].map((permission) => ({
    permission,
    effect: 'ALLOW',
    scopeType: 'COMPANY',
    scopeId: 'company',
  })),
};

const fixtureMember = context.membership;
if (fixtureMember === null) throw new Error('Missing fixture membership');

it.each(['SAVE', 'REVOKE'] as const)(
  'only owner can %s ALLOW or DENY through either management scope',
  (operation) => {
    for (const effect of ['ALLOW', 'DENY'] as const) {
      for (const managementBusinessId of [undefined, 'business']) {
        for (const custom of [false, true]) {
          const member = fixtureMember;
          const c = {
            ...context,
            ...(managementBusinessId === undefined ? {} : { managementBusinessId }),
            membership: {
              ...member,
              systemRoleCode: custom ? null : 'staff',
              allowedPermissions: custom ? null : [code],
            },
          };
          expect(permissionEditFailure({ ...terms, effect }, c, operation)).toBe(
            'PERMISSION_OWNER_ONLY',
          );
          expect(
            permissionEditFailure(
              { ...terms, effect },
              { ...c, editorIsCompanyOwner: true },
              operation,
            ),
          ).toBeNull();
        }
      }
    }
  },
);

it('catalog activation is required and unrelated unknown codes still fail', () => {
  const owner = { ...context, editorIsCompanyOwner: true };
  expect(permissionEditFailure(terms, { ...owner, catalog: [] })).toBe('FORBIDDEN');
  expect(
    permissionEditFailure({ ...terms, permission_code: 'manage:unknown:business' }, owner),
  ).toBe('FORBIDDEN');
});

it('device ALLOW is forbidden; DENY remains available to owner', () => {
  const device = {
    ...context,
    editorIsCompanyOwner: true,
    membership: { ...fixtureMember, systemRoleCode: 'device', allowedPermissions: [] },
  };
  expect(permissionEditFailure(terms, device)).toBe('PERMISSION_ROLE_FORBIDDEN');
  expect(permissionEditFailure({ ...terms, effect: 'DENY' }, device)).toBeNull();
});

it('self, canonical owner, scope and membership lifecycle protections remain', () => {
  const owner = { ...context, editorIsCompanyOwner: true };
  expect(permissionEditFailure(terms, { ...owner, editorUserId: 'target' })).toBe(
    'PERMISSION_SELF_EDIT',
  );
  expect(
    permissionEditFailure(
      { ...terms, effect: 'DENY' },
      {
        ...owner,
        membership: {
          ...fixtureMember,
          isCompanyOwner: true,
          scopeType: 'COMPANY',
          scopeId: 'company',
        },
      },
    ),
  ).toBe('PERMISSION_OWNER_PROTECTED');
  expect(permissionEditFailure(terms, { ...owner, managementBusinessId: 'other' })).toBe(
    'FORBIDDEN',
  );
  expect(
    permissionEditFailure(terms, {
      ...owner,
      membership: { ...fixtureMember, endsAt: context.now },
    }),
  ).toBe('FORBIDDEN');
});
