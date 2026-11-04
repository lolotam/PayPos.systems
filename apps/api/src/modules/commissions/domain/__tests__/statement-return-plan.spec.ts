import { describe, expect, it } from 'vitest';

import {
  planCommissionStatementReturn,
  type CommissionStatementReturnInput,
} from '../statement-return-plan.ts';

const REASON = 'خطة سوسن غلط';
const RECORDED_AT = new Date('2026-11-04T06:30:00.000Z');

const base = {
  statementId: 'statement-1',
  status: 'REVIEWED' as const,
  actorUserId: 'user-1',
  actorMembershipId: 'membership-1',
  recordedAt: RECORDED_AT,
  normalizedReason: REASON,
};

const planReturn = planCommissionStatementReturn;

function returned(input: CommissionStatementReturnInput) {
  const result = planReturn(input);
  if (result.kind !== 'RETURNED') throw new Error('expected a returned plan');
  return result;
}

describe('planCommissionStatementReturn', () => {
  it('writes only for REVIEWED and refuses the other three statuses', () => {
    const statuses = ['DRAFT', 'REVIEWED', 'APPROVED', 'PAID'] as const;
    const kinds = statuses.map((status) => planReturn({ ...base, status }).kind);
    expect(kinds).toEqual(['NOT_REVIEWED', 'RETURNED', 'NOT_REVIEWED', 'NOT_REVIEWED']);
  });

  it('returns the statement to DRAFT and clears exactly the review facts', () => {
    const result = returned({ ...base });
    expect(Object.keys(result.transition).sort()).toEqual(['review', 'statementId', 'status']);
    expect(Object.keys(result.transition.review).sort()).toEqual([
      'actorMembershipId',
      'actorUserId',
      'fingerprint',
      'recordedAt',
      'statementFingerprint',
    ]);
    expect(result.transition).toEqual({
      statementId: 'statement-1',
      status: 'DRAFT',
      review: {
        fingerprint: null,
        statementFingerprint: null,
        actorUserId: null,
        actorMembershipId: null,
        recordedAt: null,
      },
    });
  });

  it('refuses a draft or closed statement without a write plan, a record or the reason', () => {
    for (const status of ['DRAFT', 'APPROVED', 'PAID'] as const) {
      const result = planReturn({ ...base, status });
      expect(result.kind).toBe('NOT_REVIEWED');
      expect(Object.keys(result)).toEqual(['kind', 'status']);
      expect('transition' in result).toBe(false);
      expect('privateReturn' in result).toBe(false);
      expect(JSON.stringify(result)).not.toContain(REASON);
    }
  });
});

describe('statement return private record', () => {
  it('carries the injected actor, membership and recording time into the private record', () => {
    const injectedAt = new Date('2026-11-05T09:00:00.000Z');
    const input = { ...base, recordedAt: injectedAt, actorUserId: 'user-9' };
    const result = returned(input);
    expect(result.privateReturn.actorUserId).toBe('user-9');
    expect(result.privateReturn.actorMembershipId).toBe(input.actorMembershipId);
    expect(result.privateReturn.recordedAt).toBe(injectedAt);
  });

  it('keeps the reason inside the private insert record only', () => {
    const result = returned({ ...base });
    expect(result.privateReturn.reason).toBe(REASON);
    expect(JSON.stringify(result.transition)).not.toContain(REASON);
    expect(JSON.stringify(result).split(REASON).length - 1).toBe(1);
  });

  it('exposes exact key sets with no money, event, audit text or fingerprint value', () => {
    const result = returned({ ...base });
    expect(Object.keys(result).sort()).toEqual(['kind', 'privateReturn', 'transition']);
    expect(Object.keys(result.privateReturn).sort()).toEqual([
      'actorMembershipId',
      'actorUserId',
      'reason',
      'recordedAt',
      'statementId',
    ]);
    const keys = [
      ...Object.keys(result),
      ...Object.keys(result.transition),
      ...Object.keys(result.transition.review),
      ...Object.keys(result.privateReturn),
    ];
    expect(keys.filter((key) => /amount|total|audit|event/i.test(key))).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe('statement return input preservation', () => {
  it('does not mutate a frozen input and builds fresh objects', () => {
    const frozen = Object.freeze({ ...base });
    const before = JSON.stringify(frozen);
    const result = returned(frozen);
    expect(JSON.stringify(frozen)).toBe(before);
    expect(Object.is(result.transition, result.privateReturn)).toBe(false);
    expect(Object.is(result.transition, frozen)).toBe(false);
    expect(result.privateReturn.reason).toBe(REASON);
  });

  it('imposes no restriction on who returns the statement', () => {
    const input = { ...base, actorUserId: 'user-2', actorMembershipId: 'membership-2' };
    const result = returned(input);
    expect(result.privateReturn.actorUserId).toBe('user-2');
    expect(result.privateReturn.actorMembershipId).toBe('membership-2');
    expect(result.transition.review.actorUserId).toBeNull();
    expect(result.transition.review.actorMembershipId).toBeNull();
  });
});
