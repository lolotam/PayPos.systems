import { expect, it } from 'vitest';
import { normalizeEditReason } from '../line-edit-reason.ts';
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

it('rejects an undefined reason', () => {
  expect(thrown(() => normalizeEditReason(undefined)).code).toBe('SESSION_EDIT_REASON_INVALID');
});

it('rejects a blank reason', () => {
  expect(thrown(() => normalizeEditReason('   ')).code).toBe('SESSION_EDIT_REASON_INVALID');
});

it('rejects a reason of only tab, CR and LF', () => {
  expect(thrown(() => normalizeEditReason('\t\r\n \n')).code).toBe('SESSION_EDIT_REASON_INVALID');
});

it('trims only space, tab, CR and LF at both ends', () => {
  expect(normalizeEditReason(' \t\r\nوعد للعميلة\n\r\t ')).toBe('وعد للعميلة');
});

it('keeps spaces inside the reason', () => {
  expect(normalizeEditReason('وعد \t للعميلة')).toBe('وعد \t للعميلة');
});

it('keeps a non-breaking space because the database trim set does not include it', () => {
  expect(normalizeEditReason('\u00A0سبب\u00A0')).toBe('\u00A0سبب\u00A0');
});

it('accepts a reason of exactly 500 code points', () => {
  const reason = 'ا'.repeat(500);
  expect(normalizeEditReason(reason)).toBe(reason);
});

it('counts code points after trimming the edges', () => {
  expect(normalizeEditReason(` ${'ا'.repeat(500)} `)).toBe('ا'.repeat(500));
});

it('rejects a reason of 501 code points', () => {
  expect(thrown(() => normalizeEditReason('ا'.repeat(501))).code).toBe(
    'SESSION_EDIT_REASON_INVALID',
  );
});

it('accepts 500 emoji as 500 code points', () => {
  const reason = '😀'.repeat(500);
  expect(reason.length).toBe(1000);
  expect(normalizeEditReason(reason)).toBe(reason);
});

it('rejects 501 emoji', () => {
  expect(thrown(() => normalizeEditReason('😀'.repeat(501))).code).toBe(
    'SESSION_EDIT_REASON_INVALID',
  );
});

it('rejects an over-long mixed-whitespace body in well under a second', () => {
  const body = ('a' + ' '.repeat(100_000)).repeat(8) + 'b';
  const started = Date.now();
  expect(thrown(() => normalizeEditReason(body)).code).toBe('SESSION_EDIT_REASON_INVALID');
  expect(Date.now() - started).toBeLessThan(1_000);
}, 2_000);

it('rejects a NUL inside the reason', () => {
  expect(thrown(() => normalizeEditReason('سبب\u0000التعديل')).code).toBe(
    'SESSION_EDIT_REASON_INVALID',
  );
});

it('rejects a lone high surrogate', () => {
  expect(thrown(() => normalizeEditReason('سبب\uD800')).code).toBe('SESSION_EDIT_REASON_INVALID');
});

it('rejects a lone low surrogate', () => {
  expect(thrown(() => normalizeEditReason('\uDC00سبب')).code).toBe('SESSION_EDIT_REASON_INVALID');
});

it('accepts a valid emoji surrogate pair', () => {
  expect(normalizeEditReason('تعديل 😀')).toBe('تعديل 😀');
});
