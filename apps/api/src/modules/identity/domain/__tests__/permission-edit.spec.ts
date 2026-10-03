import { expect, it } from 'vitest';
import {
  permissionEditFailure,
  permissionHolderIsOwner,
  type PermissionEditContext,
  type OverrideTerms,
} from '../permission-edit.ts';
import type { AccessGrant } from '../access.ts';

const companyId = 'company';
const permission = 'read:settings:business';
const now = new Date('2026-10-03T10:00:00Z');
const terms: OverrideTerms = {
  permission_code: permission,
  effect: 'ALLOW',
  scope_type: 'COMPANY',
  scope_id: companyId,
  reason: 'synthetic',
  expires_at: null,
};
const grant = (
  permission: string,
  scopeType: AccessGrant['scopeType'] = 'COMPANY',
  scopeId = companyId,
  effect: AccessGrant['effect'] = 'ALLOW',
): AccessGrant => ({ permission, scopeType, scopeId, effect });
const member = {
  id: 'member',
  userId: 'target',
  employeeId: null,
  roleCode: 'viewer',
  scopeType: 'BRANCH' as const,
  scopeId: 'original-branch',
  startsAt: new Date('2020-01-01'),
  endsAt: null,
};
const manage = grant('manage:memberships:company');
const context: PermissionEditContext = {
  companyId,
  editorUserId: 'editor',
  now,
  membership: member,
  holderMemberships: [member],
  catalog: [permission],
  target: { companyId },
  descendantTargets: [],
  grants: [grant('manage:memberships:company'), grant(permission)],
};

it.each(['ALLOW', 'DENY'] as const)('allows %s when the editor effectively holds it', (effect) => {
  expect(permissionEditFailure({ ...terms, effect }, context)).toBeNull();
});
it.each(['COMPANY', 'BUSINESS', 'BRANCH'] as const)('company grants cover %s', (scope_type) => {
  const scope_id = scope_type === 'COMPANY' ? companyId : 'scope';
  expect(
    permissionEditFailure(
      { ...terms, scope_type, scope_id },
      { ...context, target: { companyId, businessId: 'scope', branchId: 'scope' } },
    ),
  ).toBeNull();
});
it('business grants cover its branches, branch grants cannot broaden to a business', () => {
  const grants = [manage, grant(permission, 'BUSINESS', 'business')];
  expect(
    permissionEditFailure(
      { ...terms, scope_type: 'BRANCH', scope_id: 'branch' },
      { ...context, grants, target: { companyId, businessId: 'business', branchId: 'branch' } },
    ),
  ).toBeNull();
  expect(permissionEditFailure(terms, { ...context, grants })).toBe(
    'PERMISSION_SCOPE_OUTSIDE_REACH',
  );
  expect(
    permissionEditFailure(
      { ...terms, scope_type: 'BUSINESS', scope_id: 'business' },
      {
        ...context,
        target: { companyId, businessId: 'business' },
        grants: [manage, grant(permission, 'BRANCH', 'branch')],
      },
    ),
  ).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
});
it('requires live company management, respecting its DENY', () => {
  expect(permissionEditFailure(terms, { ...context, grants: [grant(permission)] })).toBe(
    'FORBIDDEN',
  );
  expect(
    permissionEditFailure(terms, {
      ...context,
      grants: [
        ...context.grants,
        grant('manage:memberships:company', 'COMPANY', companyId, 'DENY'),
      ],
    }),
  ).toBe('FORBIDDEN');
});
it('requires the edited permission and lets DENY win', () => {
  expect(permissionEditFailure(terms, { ...context, grants: [manage] })).toBe(
    'PERMISSION_NOT_HELD',
  );
  expect(
    permissionEditFailure(terms, {
      ...context,
      grants: [...context.grants, grant(permission, 'COMPANY', companyId, 'DENY')],
    }),
  ).toBe('PERMISSION_NOT_HELD');
});
it('cannot bypass a descendant DENY by delegating broadly', () => {
  const child = { companyId, businessId: 'business', branchId: 'denied' };
  expect(
    permissionEditFailure(terms, {
      ...context,
      descendantTargets: [child],
      grants: [...context.grants, grant(permission, 'BRANCH', 'denied', 'DENY')],
    }),
  ).toBe('PERMISSION_NOT_HELD');
});
it.each(['SAVE', 'REVOKE'] as const)('never permits self %s', (operation) => {
  expect(
    permissionEditFailure(
      terms,
      { ...context, membership: { ...member, userId: 'editor' } },
      operation,
    ),
  ).toBe('PERMISSION_SELF_EDIT');
});
it('protects owner DENY additions, but permits ending a legacy owner DENY', () => {
  const owner = { ...context, membership: { ...member, roleCode: 'owner' } };
  expect(permissionEditFailure({ ...terms, effect: 'DENY' }, owner)).toBe(
    'PERMISSION_OWNER_PROTECTED',
  );
  expect(permissionEditFailure({ ...terms, effect: 'DENY' }, owner, 'REVOKE')).toBeNull();
  expect(permissionEditFailure(terms, owner)).toBeNull();
});

it.each(['user', 'employee'])('protects an owner %s through a Viewer sibling', (type) => {
  const holder = type === 'user' ? member : { ...member, userId: null, employeeId: 'employee' };
  const snapshot = {
    ...context,
    membership: holder,
    holderMemberships: [{ ...holder, id: 'owner-sibling', roleCode: 'owner' }],
  };
  expect(permissionHolderIsOwner(snapshot)).toBe(true);
  expect(permissionEditFailure({ ...terms, effect: 'DENY' }, snapshot)).toBe(
    'PERMISSION_OWNER_PROTECTED',
  );
  expect(permissionEditFailure(terms, snapshot)).toBeNull();
  expect(permissionEditFailure({ ...terms, effect: 'DENY' }, snapshot, 'REVOKE')).toBeNull();
});
it.each([
  { startsAt: new Date('2999-01-01') },
  { endsAt: now },
  { userId: 'someone-else' },
  { roleCode: 'viewer' },
])('ignores an inactive or unrelated owner sibling %j', (change) => {
  const snapshot = {
    ...context,
    holderMemberships: [{ ...member, id: 'sibling', roleCode: 'owner', ...change }],
  };
  expect(permissionHolderIsOwner(snapshot)).toBe(false);
  expect(permissionEditFailure({ ...terms, effect: 'DENY' }, snapshot)).toBeNull();
});

it.each([null, { companyId: 'other' }])('refuses missing or cross-company targets %j', (target) => {
  expect(permissionEditFailure(terms, { ...context, target })).toBe('FORBIDDEN');
});
it('refuses missing membership, unknown/platform permissions and wrong company id', () => {
  expect(permissionEditFailure(terms, { ...context, membership: null })).toBe('FORBIDDEN');
  expect(permissionEditFailure({ ...terms, scope_id: 'other' }, context)).toBe('FORBIDDEN');
  for (const permission_code of ['unknown:resource:branch', 'create:companies:platform'])
    expect(permissionEditFailure({ ...terms, permission_code }, context)).toBe('FORBIDDEN');
});
it.each([
  { startsAt: new Date('2999-01-01'), endsAt: null },
  { startsAt: member.startsAt, endsAt: now },
])('refuses inactive window %j', (dates) => {
  expect(permissionEditFailure(terms, { ...context, membership: { ...member, ...dates } })).toBe(
    'FORBIDDEN',
  );
});
it.each(['2026-10-03T10:00:00Z', '2020-01-01T00:00:00Z'])(
  'refuses expired new decision %s',
  (expires_at) => {
    expect(permissionEditFailure({ ...terms, expires_at }, context)).toBe('VALIDATION_FAILED');
  },
);
it('allows future expiry', () => {
  expect(
    permissionEditFailure({ ...terms, expires_at: '2999-01-01T00:00:00Z' }, context),
  ).toBeNull();
});
