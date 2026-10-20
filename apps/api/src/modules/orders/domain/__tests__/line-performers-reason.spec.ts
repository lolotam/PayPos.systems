import { expect, it } from 'vitest';
import { normalizePerformersReason } from '../line-performers-reason.ts';
import { SessionError } from '../session-error.ts';

function thrown(run: () => void): SessionError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    return error as SessionError;
  }
  throw new Error('expected a SessionError');
}

it('PC-16 refuses a missing reason so the client gets 422 and not a 400', () => {
  const error = thrown(() => normalizePerformersReason(undefined));
  expect(error.code).toBe('SESSION_PERFORMERS_REASON_INVALID');
  expect(error.details).toBeUndefined();
});

it('PC-16 refuses a blank reason', () => {
  expect(thrown(() => normalizePerformersReason('')).code).toBe('SESSION_PERFORMERS_REASON_INVALID');
  expect(thrown(() => normalizePerformersReason('   \t\r\n ')).code).toBe('SESSION_PERFORMERS_REASON_INVALID');
});

it('PC-16 refuses 501 characters and accepts 500', () => {
  expect(thrown(() => normalizePerformersReason('س'.repeat(501))).code).toBe('SESSION_PERFORMERS_REASON_INVALID');
  expect(normalizePerformersReason('س'.repeat(500))).toBe('س'.repeat(500));
});

it('PC-16 trims the edges of the reason and keeps the inside', () => {
  expect(normalizePerformersReason(' \tرنا شاركت في الشطف\r\n ')).toBe('رنا شاركت في الشطف');
});
