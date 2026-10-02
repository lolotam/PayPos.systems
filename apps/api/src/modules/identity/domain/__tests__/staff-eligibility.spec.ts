import { describe, expect, it } from 'vitest';
import { staffEligible } from '../staff-eligibility.ts';
import type { AccessGrant, ScopeType } from '../access.ts';
const target = { companyId: 'company', businessId: 'business', branchId: 'branch' };
const permission = 'login:staff:branch';

describe('explicit staff login permission and covering active membership', () => {
  it.each([
    ['COMPANY', 'company'],
    ['BUSINESS', 'business'],
    ['BRANCH', 'branch'],
  ] as [ScopeType, string][])('covers from %s', (scopeType, scopeId) => {
    const membership = { scopeType, scopeId },
      grant: AccessGrant = { ...membership, permission, effect: 'ALLOW' };
    expect(staffEligible([membership], [grant], target)).toBe(true);
    expect(staffEligible([membership], [], target)).toBe(false);
    expect(staffEligible([], [grant], target)).toBe(false);
    expect(staffEligible([{ ...membership, scopeId: 'other' }], [grant], target)).toBe(false);
  });
  it('DENY wins across covering scopes and Owner/admin permission is not an implicit grant', () => {
    const member = { scopeType: 'COMPANY' as const, scopeId: target.companyId };
    const allow: AccessGrant = { ...member, permission, effect: 'ALLOW' };
    const deny: AccessGrant = {
      scopeType: 'BRANCH',
      scopeId: target.branchId,
      permission,
      effect: 'DENY',
    };
    expect(staffEligible([member], [allow, deny], target)).toBe(false);
    expect(
      staffEligible([member], [{ ...allow, permission: 'create:companies:platform' }], target),
    ).toBe(false);
    expect(
      staffEligible([member], [{ ...allow, permission: 'manage:employees:business' }], target),
    ).toBe(false);
  });
});
