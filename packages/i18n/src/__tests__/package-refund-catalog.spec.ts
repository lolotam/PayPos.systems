import { expect, it } from 'vitest';
import { ar } from '../ar.js';
import { en } from '../en.js';

it('the refund catalog carries the same keys in both languages', () => {
  expect(Object.keys(ar.packageRefund).sort()).toEqual(Object.keys(en.packageRefund).sort());
});

it('the refund catalog names every server refusal code in both languages', () => {
  const codes = [
    'errorForbidden',
    'errorFeatureDisabled',
    'errorNotFound',
    'errorComponentNotFound',
    'errorInsufficientSlots',
    'errorExpired',
    'errorImportedDisabled',
    'errorReasonInvalid',
    'errorValidation',
    'errorNetwork',
    'errorGeneric',
  ];
  for (const code of codes) {
    expect(ar.packageRefund[code as keyof typeof ar.packageRefund].trim()).not.toBe('');
    expect(en.packageRefund[code as keyof typeof en.packageRefund].trim()).not.toBe('');
  }
});

it('the refund catalog is Arabic in Arabic and not in English', () => {
  expect(ar.packageRefund.dialogTitle).toMatch(/[\u0600-\u06FF]/);
  expect(en.packageRefund.dialogTitle).not.toMatch(/[\u0600-\u06FF]/);
  expect(ar.packageRefund.refund).toBe('استرداد');
  expect(en.packageRefund.refund).toBe('Refund');
});
