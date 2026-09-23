import { describe, expect, it } from 'vitest';

import { evaluateAccess, permissionScope, type AccessGrant } from '../access.ts';

const COMPANY = 'c0000000-0000-7000-8000-000000000001';
const OTHER_COMPANY = 'c0000000-0000-7000-8000-000000000002';
const BUSINESS = 'b0000000-0000-7000-8000-000000000001';
const OTHER_BUSINESS = 'b0000000-0000-7000-8000-000000000002';
const BRANCH_1 = 'a0000000-0000-7000-8000-000000000001';
const BRANCH_3 = 'a0000000-0000-7000-8000-000000000003';
const P = 'manage:orders:branch';

const grant = (over: Partial<AccessGrant>): AccessGrant => ({
  permission: P,
  effect: 'ALLOW',
  scopeType: 'COMPANY',
  scopeId: COMPANY,
  ...over,
});
const atBranch = (branchId: string) => ({ companyId: COMPANY, businessId: BUSINESS, branchId });

describe('evaluateAccess — deny by default', () => {
  it('refuses when nothing is granted', () => {
    expect(evaluateAccess([], P, { companyId: COMPANY })).toBe(false);
  });

  it('refuses a grant for another permission', () => {
    expect(
      evaluateAccess([grant({ permission: 'read:orders:branch' })], P, atBranch(BRANCH_1)),
    ).toBe(false);
  });

  it("refuses a company grant of another company — it never covers this company's target", () => {
    expect(evaluateAccess([grant({ scopeId: OTHER_COMPANY })], P, atBranch(BRANCH_1))).toBe(false);
  });
});

describe('evaluateAccess — coverage', () => {
  it('a company grant covers the company, its businesses and its branches', () => {
    const grants = [grant({})];
    expect(evaluateAccess(grants, P, { companyId: COMPANY })).toBe(true);
    expect(evaluateAccess(grants, P, { companyId: COMPANY, businessId: BUSINESS })).toBe(true);
    expect(evaluateAccess(grants, P, atBranch(BRANCH_1))).toBe(true);
  });

  it("a business grant covers that business's branches, not the company and not another business", () => {
    const grants = [grant({ scopeType: 'BUSINESS', scopeId: BUSINESS })];
    expect(evaluateAccess(grants, P, atBranch(BRANCH_1))).toBe(true);
    expect(evaluateAccess(grants, P, { companyId: COMPANY })).toBe(false);
    expect(evaluateAccess(grants, P, { companyId: COMPANY, businessId: OTHER_BUSINESS })).toBe(
      false,
    );
  });

  it('a branch grant covers only that branch', () => {
    const grants = [grant({ scopeType: 'BRANCH', scopeId: BRANCH_1 })];
    expect(evaluateAccess(grants, P, atBranch(BRANCH_1))).toBe(true);
    expect(evaluateAccess(grants, P, atBranch(BRANCH_3))).toBe(false);
    expect(evaluateAccess(grants, P, { companyId: COMPANY, businessId: BUSINESS })).toBe(false);
  });
});

describe('evaluateAccess — DENY wins at the target (PRD D-31)', () => {
  const grants = [
    grant({ scopeType: 'BUSINESS', scopeId: BUSINESS }),
    grant({ effect: 'DENY', scopeType: 'BRANCH', scopeId: BRANCH_3 }),
  ];

  it('a business-wide ALLOW with a DENY on branch 3 permits branch 1 and refuses branch 3', () => {
    expect(evaluateAccess(grants, P, atBranch(BRANCH_1))).toBe(true);
    expect(evaluateAccess(grants, P, atBranch(BRANCH_3))).toBe(false);
  });

  it('a company DENY beats any ALLOW beneath it, whatever the order', () => {
    const deny = grant({ effect: 'DENY' });
    const allow = grant({ scopeType: 'BRANCH', scopeId: BRANCH_1 });
    expect(evaluateAccess([allow, deny], P, atBranch(BRANCH_1))).toBe(false);
    expect(evaluateAccess([deny, allow], P, atBranch(BRANCH_1))).toBe(false);
  });

  it('a DENY that does not cover the target does not block it', () => {
    expect(
      evaluateAccess(
        [grant({}), grant({ effect: 'DENY', scopeType: 'BRANCH', scopeId: BRANCH_3 })],
        P,
        atBranch(BRANCH_1),
      ),
    ).toBe(true);
  });
});

describe('permissionScope', () => {
  it.each([
    ['manage:memberships:company', 'company'],
    ['create:branches:business', 'business'],
    ['manage:orders:branch', 'branch'],
    ['create:companies:platform', 'platform'],
    ['manage:orders', null],
    ['manage:orders:galaxy', null],
  ])('%s → %s', (permission, scope) => {
    expect(permissionScope(permission)).toBe(scope);
  });
});
