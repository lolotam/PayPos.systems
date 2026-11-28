import { describe, expect, it } from 'vitest';

import {
  evaluateAccess,
  mergeGrantConstraints,
  parsePermissionConstraints,
  permissionScope,
  type AccessGrant,
} from '../access.ts';

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

const INVALID_CONSTRAINT_INPUTS: readonly unknown[] = [
  null,
  ['max_pct'],
  { unknown_key: 5 },
  { max_pct: -1 },
  { max_pct: 101 },
  { max_pct: '10' },
  { max_pct: 10, max_amount: 'bad' },
  { max_amount: '12.5' },
  { max_amount: -5 },
  { backdate_days: 1.5 },
  '{"max_amount": 1000.0000000000000001}',
  '{"max_amount": 9007199254740993}',
  '{"backdate_days": 3.0000000000000001}',
  '{"max_rows": 10000000000000000}',
  '{"max_rows": 90071992547409930}',
  '{"backdate_days": 1e30}',
  '{"backdate_days": 1e100}',
  '{"max_pct": 100.00000000000000001}',
  '{"max_pct": 9.9999999999999999}',
  '{"max_pct": 1e-500}',
  '{"max_pct": -0.00000000000000001}',
  'not-json',
];

describe('parsePermissionConstraints', () => {
  it('returns undefined only for an empty plain object {} or "{}"', () => {
    expect(parsePermissionConstraints({})).toBeUndefined();
    expect(parsePermissionConstraints('{}')).toBeUndefined();
  });

  it('marks non-objects, unknown keys, and malformed values as invalid so merge fails closed', () => {
    for (const bad of INVALID_CONSTRAINT_INPUTS) {
      expect(parsePermissionConstraints(bad)).toEqual({ invalid: true });
    }
  });

  it('extracts valid numeric, bigint-mills money, and boolean constraints', () => {
    expect(parsePermissionConstraints('{"max_pct": 1e-101}')).toEqual({ max_pct: 1e-101 });
    expect(
      parsePermissionConstraints('{"max_amount": 1000.0, "backdate_days": 3.0, "max_pct": 100.0}'),
    ).toEqual({
      max_amount: 1000n,
      backdate_days: 3,
      max_pct: 100,
    });
    expect(parsePermissionConstraints('{"max_amount": 500000, "max_pct": 12.5}')).toEqual({
      max_amount: 500000n,
      max_pct: 12.5,
    });
    expect(
      parsePermissionConstraints({
        max_pct: 10,
        max_amount: 500000,
        max_variance: '25000',
        backdate_days: 3,
        max_rows: 100,
        manual_edit: false,
      }),
    ).toEqual({
      max_pct: 10,
      max_amount: 500000n,
      max_variance: 25000n,
      backdate_days: 3,
      max_rows: 100,
      manual_edit: false,
    });
  });
});

describe('mergeGrantConstraints — refusal and fail-closed (#10)', () => {
  it('returns null when access is refused or denied at the target', () => {
    expect(mergeGrantConstraints([], P, atBranch(BRANCH_1))).toBeNull();
    expect(
      mergeGrantConstraints(
        [
          grant({ constraints: { max_pct: 15 } }),
          grant({ effect: 'DENY', scopeType: 'BRANCH', scopeId: BRANCH_1 }),
        ],
        P,
        atBranch(BRANCH_1),
      ),
    ).toBeNull();
  });

  it('fails closed (returns null) when any covering grant has invalid constraints', () => {
    expect(
      mergeGrantConstraints(
        [
          grant({}),
          grant({ scopeType: 'BRANCH', scopeId: BRANCH_1, constraints: { invalid: true } }),
        ],
        P,
        atBranch(BRANCH_1),
      ),
    ).toBeNull();
    expect(
      mergeGrantConstraints([grant({ constraints: { max_pct: -1 } })], P, atBranch(BRANCH_1)),
    ).toBeNull();
  });
});

describe('mergeGrantConstraints — most restrictive wins (#10)', () => {
  it('returns empty constraints for unconstrained grants, and keeps constrained bounds beside an unconstrained ALLOW', () => {
    expect(mergeGrantConstraints([grant({})], P, atBranch(BRANCH_1))).toEqual({});
    expect(
      mergeGrantConstraints(
        [
          grant({}),
          grant({ scopeType: 'BRANCH', scopeId: BRANCH_1, constraints: { max_pct: 10 } }),
        ],
        P,
        atBranch(BRANCH_1),
      ),
    ).toEqual({ max_pct: 10 });
  });

  it('picks the most restrictive value across covering ALLOW grants and ignores uncovered ones', () => {
    const merged = mergeGrantConstraints(
      [
        grant({
          scopeType: 'COMPANY',
          scopeId: COMPANY,
          constraints: { max_pct: 25, max_amount: 1000000n, manual_edit: true },
        }),
        grant({
          scopeType: 'BUSINESS',
          scopeId: BUSINESS,
          constraints: { max_pct: 10, max_variance: 50000n, manual_edit: false },
        }),
        grant({
          scopeType: 'BRANCH',
          scopeId: BRANCH_3,
          constraints: { max_pct: 1, max_amount: 10000n },
        }),
      ],
      P,
      atBranch(BRANCH_1),
    );
    expect(merged).toEqual({
      max_pct: 10,
      max_amount: 1000000n,
      max_variance: 50000n,
      manual_edit: false,
    });
  });
});
