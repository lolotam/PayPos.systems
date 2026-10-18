import { expect, it } from 'vitest';
import { normalizeCancelReason } from '../line-cancel-reason.ts';
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

it('rejects a missing reason so the blank reaches the domain rule', () => {
  expect(thrown(() => normalizeCancelReason(undefined)).code).toBe('SESSION_CANCEL_REASON_INVALID');
});

it('rejects a blank reason', () => {
  expect(thrown(() => normalizeCancelReason('   ')).code).toBe('SESSION_CANCEL_REASON_INVALID');
});

it('rejects a reason of only tab, CR and LF', () => {
  expect(thrown(() => normalizeCancelReason('\t\r\n \n')).code).toBe(
    'SESSION_CANCEL_REASON_INVALID',
  );
});

it('trims space, tab, CR and LF at both ends and keeps the inside', () => {
  expect(normalizeCancelReason(' \t\r\nسبب الإلغاء\n\r\t ')).toBe('سبب الإلغاء');
  expect(normalizeCancelReason('سبب \t الإلغاء')).toBe('سبب \t الإلغاء');
});

it('accepts exactly 500 code points and a padded 500', () => {
  const reason = 'ا'.repeat(500);
  expect(normalizeCancelReason(reason)).toBe(reason);
  expect(normalizeCancelReason(` ${reason} `)).toBe(reason);
});

it('rejects 501 code points', () => {
  expect(thrown(() => normalizeCancelReason('ا'.repeat(501))).code).toBe(
    'SESSION_CANCEL_REASON_INVALID',
  );
});

it('rejects a NUL and a lone surrogate the database cannot store', () => {
  expect(thrown(() => normalizeCancelReason('سبب\u0000الإلغاء')).code).toBe(
    'SESSION_CANCEL_REASON_INVALID',
  );
  expect(thrown(() => normalizeCancelReason('سبب\uD800')).code).toBe(
    'SESSION_CANCEL_REASON_INVALID',
  );
});
