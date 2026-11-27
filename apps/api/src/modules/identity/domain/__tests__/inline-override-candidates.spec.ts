import { describe, expect, it } from 'vitest';
import {
  orderOverrideCandidateMemberships,
  shouldTransferOverrideOnBranchMove,
  type OverrideBranchMoveCandidate,
} from '../inline-override-candidates.ts';

interface Candidate {
  readonly membershipId: string;
  readonly scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  readonly scopeId: string;
}

const candidate = (
  membershipId: string,
  scopeType: Candidate['scopeType'],
  scopeId: string,
): Candidate => ({ membershipId, scopeType, scopeId });

const ids = (candidates: readonly Candidate[]): string[] =>
  candidates.map((entry) => entry.membershipId);

describe('orderOverrideCandidateMemberships', () => {
  it('puts the branch-scoped membership first when the override targets that branch', () => {
    const ordered = orderOverrideCandidateMemberships(
      [candidate('primary', 'BRANCH', 'branch-1'), candidate('extra', 'BRANCH', 'branch-2')],
      { scope_type: 'BRANCH', scope_id: 'branch-2' },
    );
    expect(ids(ordered)).toEqual(['extra', 'primary']);
  });

  it('puts the business-scoped membership first when the override targets that business', () => {
    const ordered = orderOverrideCandidateMemberships(
      [candidate('primary', 'BRANCH', 'branch-1'), candidate('business', 'BUSINESS', 'business-1')],
      { scope_type: 'BUSINESS', scope_id: 'business-1' },
    );
    expect(ids(ordered)).toEqual(['business', 'primary']);
  });

  it('puts the company-scoped membership first when the override targets the company', () => {
    const ordered = orderOverrideCandidateMemberships(
      [candidate('primary', 'BRANCH', 'branch-1'), candidate('company', 'COMPANY', 'company-1')],
      { scope_type: 'COMPANY', scope_id: 'company-1' },
    );
    expect(ids(ordered)).toEqual(['company', 'primary']);
  });

  it('falls back to the primary membership when no scope matches', () => {
    const ordered = orderOverrideCandidateMemberships(
      [candidate('primary', 'BRANCH', 'branch-1'), candidate('extra', 'BRANCH', 'branch-2')],
      { scope_type: 'BRANCH', scope_id: 'branch-3' },
    );
    expect(ids(ordered)).toEqual(['primary', 'extra']);
  });

  it('keeps the remaining memberships in their original order after the primary one', () => {
    const ordered = orderOverrideCandidateMemberships(
      [
        candidate('primary', 'BRANCH', 'branch-1'),
        candidate('extra-a', 'BRANCH', 'branch-2'),
        candidate('extra-b', 'BRANCH', 'branch-3'),
      ],
      { scope_type: 'BRANCH', scope_id: 'branch-3' },
    );
    expect(ids(ordered)).toEqual(['extra-b', 'primary', 'extra-a']);
  });
});

// UUID مش حساس لحالة الأحرف، فالمطابقة على المعرّف بتتطبّع قبل المقارنة.
describe('orderOverrideCandidateMemberships with a mixed-case scope id', () => {
  it('matches a scope id written with a different letter case', () => {
    const ordered = orderOverrideCandidateMemberships(
      [
        candidate('primary', 'BRANCH', '01920000-0000-7000-8000-00000000000A'),
        candidate('extra', 'BRANCH', '01920000-0000-7000-8000-00000000000b'),
      ],
      { scope_type: 'BRANCH', scope_id: '01920000-0000-7000-8000-00000000000B' },
    );
    expect(ids(ordered)).toEqual(['extra', 'primary']);
  });

  it('never repeats the primary membership when it is the matching one', () => {
    const ordered = orderOverrideCandidateMemberships(
      [candidate('primary', 'BRANCH', 'branch-1'), candidate('extra', 'BRANCH', 'branch-2')],
      { scope_type: 'BRANCH', scope_id: 'branch-1' },
    );
    expect(ids(ordered)).toEqual(['primary', 'extra']);
  });
});

// قاعدة أهلية نقل الاستثناء عند تغيير الفرع الأساسي (080-b) — قاعدة صافية بلا قاعدة بيانات.
const AT = new Date('2026-11-27T00:00:00.000Z');

const moveCandidate = (
  overrides: Partial<OverrideBranchMoveCandidate> &
    Pick<OverrideBranchMoveCandidate, 'source' | 'effect'>,
): OverrideBranchMoveCandidate => ({
  scopeType: 'BRANCH',
  permissionCode: 'read:attendance:branch',
  expiresAt: null,
  ...overrides,
});

describe('shouldTransferOverrideOnBranchMove from the old primary', () => {
  it('never transfers an override whose expiry has passed', () => {
    const expired = new Date('2026-11-26T00:00:00.000Z');
    expect(
      shouldTransferOverrideOnBranchMove(
        moveCandidate({
          source: 'old_primary',
          effect: 'DENY',
          scopeType: 'COMPANY',
          expiresAt: expired,
        }),
        [],
        AT,
      ),
    ).toBe(false);
  });

  it('transfers a company or business deny', () => {
    for (const scopeType of ['COMPANY', 'BUSINESS'] as const) {
      expect(
        shouldTransferOverrideOnBranchMove(
          moveCandidate({ source: 'old_primary', effect: 'DENY', scopeType }),
          [],
          AT,
        ),
      ).toBe(true);
    }
  });

  it('leaves an allow or a branch scoped deny on the old membership', () => {
    for (const scopeType of ['COMPANY', 'BUSINESS'] as const) {
      expect(
        shouldTransferOverrideOnBranchMove(
          moveCandidate({ source: 'old_primary', effect: 'ALLOW', scopeType }),
          ['read:attendance:branch'],
          AT,
        ),
      ).toBe(false);
    }
    for (const effect of ['ALLOW', 'DENY'] as const) {
      expect(
        shouldTransferOverrideOnBranchMove(
          moveCandidate({ source: 'old_primary', effect, scopeType: 'BRANCH' }),
          [],
          AT,
        ),
      ).toBe(false);
    }
  });
});

describe('shouldTransferOverrideOnBranchMove from the merged extra branch', () => {
  it('never transfers an override whose expiry has passed', () => {
    expect(
      shouldTransferOverrideOnBranchMove(
        moveCandidate({
          source: 'merged_extra',
          effect: 'DENY',
          expiresAt: new Date('2026-11-26T00:00:00.000Z'),
        }),
        ['read:attendance:branch'],
        AT,
      ),
    ).toBe(false);
  });

  it('transfers a deny whatever the new role allows', () => {
    expect(
      shouldTransferOverrideOnBranchMove(
        moveCandidate({ source: 'merged_extra', effect: 'DENY' }),
        [],
        AT,
      ),
    ).toBe(true);
  });

  it('transfers an allow only when the new role allows it', () => {
    expect(
      shouldTransferOverrideOnBranchMove(
        moveCandidate({ source: 'merged_extra', effect: 'ALLOW' }),
        ['read:attendance:branch'],
        AT,
      ),
    ).toBe(true);
    expect(
      shouldTransferOverrideOnBranchMove(
        moveCandidate({ source: 'merged_extra', effect: 'ALLOW' }),
        ['read:commissions:own'],
        AT,
      ),
    ).toBe(false);
  });
});
