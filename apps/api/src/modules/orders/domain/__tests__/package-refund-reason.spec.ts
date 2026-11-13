import { serviceSessionErrors } from '@pospay/i18n';
import { expect, it } from 'vitest';
import { PackageRefundError } from '../package-refund-error.js';
import { normalizeRefundReason } from '../package-refund-reason.js';

it('trims the reason and keeps one character', () => {
  expect(normalizeRefundReason('  Customer asked  ')).toBe('Customer asked');
  expect(normalizeRefundReason('x')).toBe('x');
});

it('keeps a reason of 500 code points', () => {
  const astral = '😀'.repeat(500);
  expect(normalizeRefundReason(astral)).toBe(astral);
});

it.each([
  ['an empty reason', ''],
  ['a blank reason', ' \t\r\n '],
  ['a reason of 501 characters', 'x'.repeat(501)],
  ['a missing reason', undefined],
  ['a reason carrying a NUL byte', `ok${String.fromCharCode(0)}no`],
])('refuses %s with the refund reason code', (_name, reason) => {
  const error = (() => {
    try {
      normalizeRefundReason(reason);
      return null;
    } catch (caught) {
      return caught;
    }
  })();
  expect(error).toBeInstanceOf(PackageRefundError);
  expect((error as PackageRefundError).code).toBe('PACKAGE_REFUND_REASON_INVALID');
});

it('publishes one message for the expired package in both languages', () => {
  expect(serviceSessionErrors.PACKAGE_EXPIRED).toEqual({
    message_ar: 'الباقة خلصت صلاحيتها.',
    message_en: 'The package has expired.',
  });
});
