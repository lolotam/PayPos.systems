import { describe, expect, it } from 'vitest';

import {
  planCommissionStatementReview,
  type CommissionStatementReviewInput,
} from '../statement-review-plan.ts';

const INPUT = 'a'.repeat(64);
const STATEMENT = 'b'.repeat(64);
const OTHER = 'c'.repeat(64);
const RECORDED_AT = new Date('2026-12-02T09:00:00.000Z');

const base: CommissionStatementReviewInput = {
  statementId: 'statement-1',
  status: 'DRAFT',
  actorUserId: 'user-1',
  actorMembershipId: 'membership-1',
  recordedAt: RECORDED_AT,
  expectedFingerprint: INPUT,
  expectedStatementFingerprint: STATEMENT,
  currentFingerprint: INPUT,
  currentStatementFingerprint: STATEMENT,
  pricingFailures: [],
  blockedCorrections: [],
};

function plan(input: Partial<CommissionStatementReviewInput> = {}) {
  return planCommissionStatementReview({ ...base, ...input });
}

describe('planCommissionStatementReview', () => {
  it('reviews a draft whose fingerprints match and records the reviewer and the time', () => {
    const result = plan();
    expect(result.kind).toBe('REVIEWED');
    if (result.kind !== 'REVIEWED') return;
    expect(result.transition).toEqual({
      statementId: 'statement-1',
      status: 'REVIEWED',
      review: {
        fingerprint: INPUT,
        statementFingerprint: STATEMENT,
        actorUserId: 'user-1',
        actorMembershipId: 'membership-1',
        recordedAt: RECORDED_AT,
      },
    });
  });

  it('refuses a statement that is not a draft without a write plan', () => {
    for (const status of ['REVIEWED', 'APPROVED', 'PAID'] as const) {
      const result = plan({ status });
      expect(result.kind).toBe('NOT_DRAFT');
      expect('transition' in result).toBe(false);
    }
  });

  it('refuses a month with a pricing failure and names the employee and the code', () => {
    const result = plan({ pricingFailures: [{ employeeId: 'employee-1', code: 'NO_PLAN' }] });
    expect(result.kind).toBe('BLOCKED');
    if (result.kind !== 'BLOCKED') return;
    expect(result.issues).toEqual([{ employeeId: 'employee-1', code: 'NO_PLAN' }]);
  });

  it('refuses a month that is the stored target of an open blocked correction (FR-048)', () => {
    const result = plan({
      blockedCorrections: [{ employeeId: 'employee-2', code: 'NO_SALARY' }],
    });
    expect(result.kind).toBe('BLOCKED');
    if (result.kind !== 'BLOCKED') return;
    expect(result.issues).toEqual([{ employeeId: 'employee-2', code: 'NO_SALARY' }]);
  });

  it('refuses a stale input fingerprint and reports INPUTS with the current fingerprints', () => {
    const result = plan({ currentFingerprint: OTHER });
    expect(result.kind).toBe('STALE');
    if (result.kind !== 'STALE') return;
    expect(result.changed).toBe('INPUTS');
    expect(result.currentFingerprint).toBe(OTHER);
    expect(result.currentStatementFingerprint).toBe(STATEMENT);
  });
});

describe('the review plan refusals', () => {
  it('refuses a stale statement fingerprint and reports STATEMENT', () => {
    const result = plan({ currentStatementFingerprint: OTHER });
    expect(result.kind).toBe('STALE');
    if (result.kind !== 'STALE') return;
    expect(result.changed).toBe('STATEMENT');
  });

  it('checks the status before the issues and the issues before the fingerprints', () => {
    const stale = { currentFingerprint: OTHER };
    expect(plan({ status: 'REVIEWED', ...stale }).kind).toBe('NOT_DRAFT');
    expect(
      plan({
        pricingFailures: [{ employeeId: 'employee-1', code: 'NO_PLAN' }],
        ...stale,
      }).kind,
    ).toBe('BLOCKED');
  });
});

describe('the review plan shape', () => {
  it('never carries a reason or an amount into the plan', () => {
    const result = plan();
    expect(JSON.stringify(result)).not.toMatch(/amount|total|reason/i);
    expect(Object.keys(result)).toEqual(['kind', 'transition']);
  });
});
