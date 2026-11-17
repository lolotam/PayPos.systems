import { describe, expect, it } from 'vitest';

import type { Failure } from '@/shared/api/call';
import { pinDecisionOutcome } from './pin-decision-outcome';

const httpFail = (code: string, status = 400, details?: unknown): Failure => ({
  kind: 'http',
  status,
  envelope: {
    code,
    message_ar: 'خطأ',
    message_en: 'Error',
    ...(details === undefined ? {} : { details }),
  },
});

describe('pinDecisionOutcome', () => {
  it('maps ok result to done', () => {
    expect(pinDecisionOutcome({ ok: true, data: {} })).toEqual({ kind: 'done' });
  });

  it.each([
    ['PIN_INVALID', 'pinInvalid'],
    ['PIN_LOCKED', 'locked'],
    ['TOO_MANY_REQUESTS', 'busy'],
  ] as const)('maps %s to kind %s', (code, kind) => {
    expect(pinDecisionOutcome({ ok: false, failure: httpFail(code) })).toEqual({ kind });
  });

  it.each(['DISCOUNT_PROPOSAL_NOT_PENDING', 'DISCOUNT_PROPOSAL_CHANGED'])(
    'maps %s to stale with original failure',
    (code) => {
      const failure = httpFail(code, 409);
      expect(pinDecisionOutcome({ ok: false, failure })).toEqual({ kind: 'stale', failure });
    },
  );

  it('maps network failure to failure with the same failure object', () => {
    const failure: Failure = { kind: 'network' };
    expect(pinDecisionOutcome({ ok: false, failure })).toEqual({ kind: 'failure', failure });
  });

  it('maps envelope-less 500 to failure with the same failure object', () => {
    const failure: Failure = { kind: 'http', status: 500, envelope: null };
    expect(pinDecisionOutcome({ ok: false, failure })).toEqual({ kind: 'failure', failure });
  });

  it('maps unknown code to failure with the same failure object', () => {
    const failure = httpFail('UNKNOWN_CODE', 418);
    expect(pinDecisionOutcome({ ok: false, failure })).toEqual({ kind: 'failure', failure });
  });
});

describe('membership-required outcome', () => {
  it('maps readable membership details to pickMembership', () => {
    const failure = httpFail('DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED', 422, {
      approver_memberships: [{ membership_id: 'm1' }, { membership_id: 'm2' }],
    });
    expect(pinDecisionOutcome({ ok: false, failure })).toEqual({
      kind: 'pickMembership',
      memberships: [
        { membershipId: 'm1', scopeType: null, role: null },
        { membershipId: 'm2', scopeType: null, role: null },
      ],
      failure,
    });
  });

  it('maps the same code without details to failure', () => {
    const failure = httpFail('DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED', 422);
    expect(pinDecisionOutcome({ ok: false, failure })).toEqual({ kind: 'failure', failure });
  });
});
