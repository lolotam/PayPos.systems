import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import { permissionEditFailure, type PermissionEditContext } from '../permission-edit.ts';
import { RATINGS_READ_PERMISSION, ratingsReadGrantFailure } from '../ratings-read-eligibility.ts';

const MANAGERS = ['owner', 'general_manager', 'business_manager', 'branch_manager'];
const OTHERS = SYSTEM_ROLES.filter((role) => !MANAGERS.includes(role.code)).map((r) => r.code);
const company = 'company';

const terms = {
  permission_code: RATINGS_READ_PERMISSION,
  effect: 'ALLOW' as const,
  scope_type: 'COMPANY' as const,
  scope_id: company,
  reason: 'Synthetic ratings grant',
  expires_at: null,
};

function context(
  systemRoleCode: string | null,
  allowedPermissions: readonly string[] | null = null,
): PermissionEditContext {
  return {
    companyId: company,
    editorUserId: 'editor',
    editorIsCompanyOwner: false,
    now: new Date('2026-11-20'),
    holderMemberships: [],
    membership: {
      id: 'member',
      userId: null,
      employeeId: 'employee',
      roleCode: 'viewer',
      systemRoleCode,
      allowedPermissions,
      isCompanyOwner: false,
      scopeType: 'COMPANY',
      scopeId: company,
      startsAt: new Date('2020-01-01'),
      endsAt: null,
    },
    target: { companyId: company },
    descendantTargets: [],
    catalog: [RATINGS_READ_PERMISSION],
    grants: ['manage:memberships:company', RATINGS_READ_PERMISSION].map((permission) => ({
      permission,
      effect: 'ALLOW' as const,
      scopeType: 'COMPANY' as const,
      scopeId: company,
    })),
  };
}

describe('ratingsReadGrantFailure', () => {
  it.each(MANAGERS)('allows an ALLOW for the manager role %s', (role) => {
    expect(ratingsReadGrantFailure(RATINGS_READ_PERMISSION, 'ALLOW', role)).toBeNull();
    expect(permissionEditFailure(terms, context(role))).toBeNull();
  });

  it.each(OTHERS)('refuses an ALLOW for the role %s with the named failure', (role) => {
    expect(ratingsReadGrantFailure(RATINGS_READ_PERMISSION, 'ALLOW', role)).toBe(
      'PERMISSION_ROLE_NOT_ELIGIBLE',
    );
    expect(permissionEditFailure(terms, context(role))).toBe('PERMISSION_ROLE_NOT_ELIGIBLE');
  });

  it('refuses a custom role, whose slot list can never prove management', () => {
    expect(ratingsReadGrantFailure(RATINGS_READ_PERMISSION, 'ALLOW', null)).toBe(
      'PERMISSION_ROLE_NOT_ELIGIBLE',
    );
    expect(permissionEditFailure(terms, context(null))).toBe('PERMISSION_ROLE_NOT_ELIGIBLE');
  });

  it('matches the code exactly, so another scope or a trailing character passes untouched', () => {
    expect(ratingsReadGrantFailure('read:ratings:own', 'ALLOW', 'cashier')).toBeNull();
    expect(ratingsReadGrantFailure('read:ratings:branch ', 'ALLOW', 'cashier')).toBeNull();
  });
});

it('never refuses a DENY, so ending a wrong grant stays possible for any role', () => {
  for (const role of [...MANAGERS, ...OTHERS, null]) {
    expect(ratingsReadGrantFailure(RATINGS_READ_PERMISSION, 'DENY', role)).toBeNull();
    expect(permissionEditFailure({ ...terms, effect: 'DENY' }, context(role))).toBeNull();
  }
});

it.each(['REVOKE', 'CHECK'] as const)('keeps %s of the ratings code open to any role', (operation) => {
  expect(permissionEditFailure(terms, context('cashier'), operation)).toBeNull();
});

describe('permissionEditFailure keeps its existing outcomes with the guard in place', () => {
  it('still refuses an unknown code first, so the guard stays inert until 61-1c seeds the catalog', () => {
    expect(
      permissionEditFailure(terms, { ...context('cashier'), catalog: ['read:memberships:company'] }),
    ).toBe('FORBIDDEN');
  });

  it('keeps the owner-only rule on a protected code for a non-owner editor', () => {
    const board = { ...terms, permission_code: 'read:attendance:branch' };
    expect(
      permissionEditFailure(board, { ...context('cashier'), catalog: [board.permission_code] }),
    ).toBe('PERMISSION_OWNER_ONLY');
  });

  it('still refuses a device membership with the generic slot failure on another code', () => {
    const refunds = { ...terms, permission_code: 'manage:imported-refunds:business' };
    expect(
      permissionEditFailure(refunds, {
        ...context('device', []),
        catalog: [refunds.permission_code],
        editorIsCompanyOwner: true,
      }),
    ).toBe('PERMISSION_ROLE_FORBIDDEN');
  });
});

describe('the ratings-read ALLOW stays inside the membership own scope (FR-B15)', () => {
  const branchTerms = { ...terms, scope_type: 'BRANCH' as const, scope_id: 'branch-1' };
  function branchMembership(systemRoleCode: string): PermissionEditContext {
    const base = context(systemRoleCode);
    if (base.membership === null) throw new Error('Synthetic membership missing');
    return {
      ...base,
      membership: { ...base.membership, scopeType: 'BRANCH', scopeId: 'branch-1' },
    };
  }

  it('refuses a wider scope than the membership own BRANCH scope with the reach failure', () => {
    expect(
      permissionEditFailure(
        { ...terms, scope_type: 'COMPANY', scope_id: company },
        branchMembership('branch_manager'),
      ),
    ).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
    expect(
      permissionEditFailure({ ...branchTerms, scope_id: 'branch-2' }, branchMembership('branch_manager')),
    ).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
    expect(
      permissionEditFailure({ ...terms, scope_type: 'COMPANY', scope_id: company }, branchMembership('cashier')),
    ).toBe('PERMISSION_SCOPE_OUTSIDE_REACH');
    expect(permissionEditFailure(branchTerms, branchMembership('branch_manager'))).toBeNull();
  });

  it('lets the named rule decide the ratings code, whatever the role slot list holds', () => {
    expect(permissionEditFailure(branchTerms, context('cashier', ['read:branches:branch']))).toBe(
      'PERMISSION_ROLE_NOT_ELIGIBLE',
    );
    expect(permissionEditFailure(branchTerms, context('cashier', [RATINGS_READ_PERMISSION]))).toBe(
      'PERMISSION_ROLE_NOT_ELIGIBLE',
    );
  });

  it('keeps the slot refusal ahead of the named rule for the device', () => {
    expect(permissionEditFailure(branchTerms, context('device', []))).toBe(
      'PERMISSION_ROLE_FORBIDDEN',
    );
  });
});
