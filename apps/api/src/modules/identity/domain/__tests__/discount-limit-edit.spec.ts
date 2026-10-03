import { expect, it } from 'vitest';
import { discountLimitEditFailure } from '../discount-limit-edit.ts';
import type { PermissionEditContext } from '../permission-edit.ts';

const member = {
  id: 'membership',
  userId: 'holder',
  employeeId: null,
  roleCode: 'viewer',
  scopeType: 'COMPANY' as const,
  scopeId: 'company',
  startsAt: new Date('2020-01-01'),
  endsAt: null,
};
const context: PermissionEditContext = {
  companyId: 'company',
  editorUserId: 'editor',
  membership: member,
  holderMemberships: [member],
  catalog: ['manage:discounts:company'],
  now: new Date('2026-10-03'),
  target: { companyId: 'company' },
  descendantTargets: [],
  grants: ['manage:memberships:company', 'manage:discounts:company'].map((permission) => ({
    permission,
    effect: 'ALLOW',
    scopeType: 'COMPANY',
    scopeId: 'company',
  })),
};
it('allows an effective editor on a non-owner holder', () => {
  expect(discountLimitEditFailure(context)).toBeNull();
});
it('protects the person through another active owner membership', () => {
  expect(
    discountLimitEditFailure({
      ...context,
      holderMemberships: [{ ...member, id: 'owner', roleCode: 'owner' }],
    }),
  ).toBe('PERMISSION_OWNER_PROTECTED');
  expect(
    discountLimitEditFailure({
      ...context,
      holderMemberships: [
        { ...member, id: 'ended', roleCode: 'owner', endsAt: new Date('2025-01-01') },
      ],
    }),
  ).toBeNull();
});
it('propagates PR 7 denials, including missing membership, management, catalog, self and inactive window', () => {
  expect(discountLimitEditFailure({ ...context, grants: [] })).toBe('FORBIDDEN');
  expect(discountLimitEditFailure({ ...context, membership: null })).toBe('FORBIDDEN');
  expect(discountLimitEditFailure({ ...context, catalog: [] })).toBe('FORBIDDEN');
  expect(discountLimitEditFailure({ ...context, editorUserId: 'holder' })).toBe(
    'PERMISSION_SELF_EDIT',
  );
  expect(
    discountLimitEditFailure({
      ...context,
      membership: { ...member, endsAt: new Date('2025-01-01') },
    }),
  ).toBe('FORBIDDEN');
  expect(discountLimitEditFailure({ ...context, grants: context.grants.slice(0, 1) })).toBe(
    'PERMISSION_NOT_HELD',
  );
});
