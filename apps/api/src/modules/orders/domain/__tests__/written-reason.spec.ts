import { expect, it } from 'vitest';
import { normalizeEditReason } from '../line-edit-reason.ts';
import { SessionError } from '../session-error.ts';
import { normalizeWrittenReason, tipReasonFor } from '../written-reason.ts';

function thrown(run: () => void): SessionError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    return error as SessionError;
  }
  throw new Error('expected a SessionError');
}

it('passes the caller code through the shared normalizer', () => {
  expect(thrown(() => normalizeWrittenReason(undefined, 'VALIDATION_FAILED')).code).toBe(
    'VALIDATION_FAILED',
  );
  expect(thrown(() => normalizeEditReason(undefined)).code).toBe('SESSION_EDIT_REASON_INVALID');
});

it('trims a tip reason and an edit reason with the same edge rule', () => {
  const raw = ' \t\r\nسبب التغيير\n\r\t ';
  expect(normalizeEditReason(raw)).toBe('سبب التغيير');
  expect(tipReasonFor(0, raw)).toBe('سبب التغيير');
  expect(tipReasonFor(3, raw)).toBe('سبب التغيير');
});

it('keeps a non-breaking space because the database trim set does not include it', () => {
  expect(tipReasonFor(1, '\u00A0سبب\u00A0')).toBe('\u00A0سبب\u00A0');
});

it('returns null for a missing or blank reason on the first entry', () => {
  expect(tipReasonFor(0, undefined)).toBeNull();
  expect(tipReasonFor(0, ' \t\r\n')).toBeNull();
});

it('requires a reason when replacing, and a blank one is not a validation failure', () => {
  expect(thrown(() => tipReasonFor(1, undefined)).code).toBe('TIP_REASON_REQUIRED');
  expect(thrown(() => tipReasonFor(4, ' \t ')).code).toBe('TIP_REASON_REQUIRED');
});

it('rejects an invalid given reason as validation failed at any revision', () => {
  expect(thrown(() => tipReasonFor(0, 'ا'.repeat(501))).code).toBe('VALIDATION_FAILED');
  expect(thrown(() => tipReasonFor(2, 'سبب\u0000التغيير')).code).toBe('VALIDATION_FAILED');
  expect(thrown(() => tipReasonFor(1, 'سبب\uD800')).code).toBe('VALIDATION_FAILED');
  expect(thrown(() => normalizeEditReason('ا'.repeat(501))).code).toBe('SESSION_EDIT_REASON_INVALID');
});

it('accepts 500 code points and a valid emoji pair', () => {
  const reason = '😀'.repeat(500);
  expect(reason.length).toBe(1000);
  expect(tipReasonFor(2, reason)).toBe(reason);
  expect(normalizeEditReason('تعديل 😀')).toBe('تعديل 😀');
});
