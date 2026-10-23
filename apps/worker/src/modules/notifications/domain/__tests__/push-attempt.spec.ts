import { describe, expect, it } from 'vitest';

import { pushAttemptDecision } from '../push-attempt.ts';

const now = new Date('2026-10-01T10:00:00Z');

describe('push attempt decision', () => {
  it('keeps an attempt pending when there is no deadline', () => {
    expect(pushAttemptDecision(null, now)).toEqual({ status: 'PENDING' });
  });

  it('keeps an attempt pending when the deadline is still ahead', () => {
    expect(pushAttemptDecision(new Date('2026-10-01T11:00:00Z'), now)).toEqual({
      status: 'PENDING',
    });
  });

  it('expires an attempt whose deadline is exactly now', () => {
    expect(pushAttemptDecision(now, now)).toEqual({
      status: 'EXPIRED',
      failureCode: 'DEADLINE_EXPIRED',
    });
  });

  it('expires an attempt whose deadline has passed', () => {
    expect(pushAttemptDecision(new Date('2026-10-01T09:59:59Z'), now)).toEqual({
      status: 'EXPIRED',
      failureCode: 'DEADLINE_EXPIRED',
    });
  });
});
