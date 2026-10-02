import { describe, expect, it } from 'vitest';
import {
  permissionEditFailure,
  permissionEditingEnabled,
  type PermissionEditContext,
  type OverrideTerms,
} from '../permission-edit.ts';

const companyId = '01920000-0000-7000-8000-0000000000a0';
const terms: OverrideTerms = {
  permission_code: 'read:memberships:company',
  effect: 'ALLOW',
  scope_type: 'COMPANY',
  scope_id: companyId,
  reason: 'synthetic',
  expires_at: null,
};
const context: PermissionEditContext = {
  companyId,
  now: new Date('2026-10-02T10:00:00Z'),
  membership: {
    id: companyId,
    scopeType: 'COMPANY',
    scopeId: companyId,
    startsAt: new Date('2020-01-01T00:00:00Z'),
    endsAt: null,
  },
  catalog: [terms.permission_code],
  target: { companyId },
  grants: [
    {
      permission: 'manage:memberships:company',
      effect: 'ALLOW',
      scopeType: 'COMPANY',
      scopeId: companyId,
    },
  ],
};

describe('permission edit invariants', () => {
  it.each(['ALLOW', 'DENY'] as const)(
    'keeps %s disabled until the owner settles the editing policy',
    (effect) => {
      expect(permissionEditingEnabled()).toBe(false);
      expect(permissionEditFailure({ ...terms, effect }, context)).toBe(
        'PERMISSION_POLICY_UNRESOLVED',
      );
    },
  );
  it.each(['BUSINESS', 'BRANCH'] as const)('also gates %s override writes', (scope_type) => {
    expect(
      permissionEditFailure(
        { ...terms, scope_type },
        { ...context, target: { companyId, businessId: companyId, branchId: companyId } },
      ),
    ).toBe('PERMISSION_POLICY_UNRESOLVED');
  });
  it('requires a current management grant and respects a DENY', () => {
    expect(permissionEditFailure(terms, { ...context, grants: [] })).toBe('FORBIDDEN');
    expect(
      permissionEditFailure(terms, {
        ...context,
        grants: [
          ...context.grants,
          {
            permission: 'manage:memberships:company',
            scopeType: 'COMPANY',
            scopeId: companyId,
            effect: 'DENY',
          },
        ],
      }),
    ).toBe('FORBIDDEN');
  });
});

describe('permission input boundaries', () => {
  it('refuses absent membership, cross-company scope, absent target, and unknown/platform permission', () => {
    for (const changed of [
      { ...context, membership: null },
      { ...context, target: null },
    ]) {
      expect(permissionEditFailure(terms, changed)).toBe('FORBIDDEN');
    }
    expect(permissionEditFailure({ ...terms, scope_id: 'other' }, context)).toBe('FORBIDDEN');
    for (const permission_code of ['unknown:resource:branch', 'create:companies:platform']) {
      expect(
        permissionEditFailure(
          { ...terms, permission_code },
          { ...context, catalog: [...context.catalog, 'create:companies:platform'] },
        ),
      ).toBe('FORBIDDEN');
    }
  });
  it('refuses future/ended memberships and expiry at or before the injected time', () => {
    for (const dates of [
      { startsAt: new Date('2999-01-01'), endsAt: null },
      { startsAt: new Date('2020-01-01'), endsAt: context.now },
    ]) {
      expect(
        permissionEditFailure(terms, {
          ...context,
          membership: {
            ...(context.membership as NonNullable<PermissionEditContext['membership']>),
            ...dates,
          },
        }),
      ).toBe('FORBIDDEN');
    }
    expect(
      permissionEditFailure({ ...terms, expires_at: context.now.toISOString() }, context),
    ).toBe('VALIDATION_FAILED');
    expect(permissionEditFailure({ ...terms, expires_at: '2999-01-01T00:00:00Z' }, context)).toBe(
      'PERMISSION_POLICY_UNRESOLVED',
    );
  });
});
