import { expect, it } from 'vitest';
import {
  freeRefundSlots,
  refundErrorMessageKey,
  refundPackageBody,
  refundPackageResolver,
  refundPreviewAmount,
  refundPreviewMills,
  remainingFreeSessions,
  trimRefundReason,
  type RefundPackageComponent,
  type RefundPackageFormValues,
} from './refund-package-values';

const component: RefundPackageComponent = {
  id: '01920000-0000-7000-8000-000000000020',
  name_en: 'Cut',
  name_ar: 'قص',
  remaining: 2,
  slots: [
    { ordinal: 1, state: 'USED', unit_value: '2.250' },
    { ordinal: 2, state: 'FREE', unit_value: '2.250' },
    { ordinal: 3, state: 'FREE', unit_value: '2.250' },
  ],
};

const base: RefundPackageFormValues = {
  component_id: component.id,
  sessions: 1,
  method: 'CASH',
  reason: 'Synthetic reason',
};

function resolve(values: RefundPackageFormValues) {
  const result = refundPackageResolver([component])(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  });
  if (result instanceof Promise) throw new Error('Expected the synchronous refund resolver');
  return result;
}

it('lists the free sessions newest first and counts them', () => {
  expect(freeRefundSlots(component).map((slot) => slot.ordinal)).toEqual([3, 2]);
  expect(remainingFreeSessions(component)).toBe(2);
});

it('sums the highest free sessions in bigint mills, never in floats', () => {
  expect(refundPreviewMills(component, 1)).toBe(2250n);
  expect(refundPreviewMills(component, 2)).toBe(4500n);
  expect(refundPreviewMills(component, 3)).toBe(0n);
  expect(refundPreviewMills(component, 0)).toBe(0n);
  expect(refundPreviewMills(undefined, 1)).toBe(0n);
  expect(refundPreviewAmount(component, 2)).toBe('4.500');
});

it('keeps the fractional mills exact for a value that a float would round', () => {
  const odd: RefundPackageComponent = {
    ...component,
    slots: [
      { ordinal: 1, state: 'FREE', unit_value: '0.001' },
      { ordinal: 2, state: 'FREE', unit_value: '0.002' },
      { ordinal: 3, state: 'FREE', unit_value: '0.003' },
    ],
  };
  expect(refundPreviewMills(odd, 3)).toBe(6n);
  expect(refundPreviewAmount(odd, 3)).toBe('0.006');
});

it('trims only space, tab, CR and LF and accepts exactly 500 code points', () => {
  expect(trimRefundReason(' \t\r\nSynthetic reason \t\r\n ')).toBe('Synthetic reason');
  const reason = ` \t\r\n${'a'.repeat(500)} \t\r\n `;
  const result = resolve({ ...base, reason });
  expect(result.errors).toEqual({});
  expect(result.values).toEqual({ ...base, reason: 'a'.repeat(500) });
});

it('counts astral characters as code points and refuses 501', () => {
  expect(resolve({ ...base, reason: '😀'.repeat(500) }).errors).toEqual({});
  expect(resolve({ ...base, reason: '😀'.repeat(501) }).errors.reason).toEqual({
    type: 'custom',
    message: 'reasonTooLong',
  });
});

it('refuses a missing component, an empty reason and a session count out of range', () => {
  expect(resolve({ ...base, component_id: '' }).errors.component_id).toEqual({
    type: 'custom',
    message: 'componentRequired',
  });
  expect(resolve({ ...base, reason: ' \t\r\n ' }).errors.reason).toEqual({
    type: 'custom',
    message: 'reasonRequired',
  });
  expect(resolve({ ...base, sessions: 0 }).errors.sessions).toEqual({
    type: 'custom',
    message: 'sessionsRequired',
  });
  expect(resolve({ ...base, sessions: 1.5 }).errors.sessions).toEqual({
    type: 'custom',
    message: 'sessionsRequired',
  });
  expect(resolve({ ...base, sessions: 3 }).errors.sessions).toEqual({
    type: 'custom',
    message: 'sessionsTooMany',
  });
});

it('accepts a session count inside the free sessions and builds the request body', () => {
  const result = resolve({ ...base, sessions: 2, method: 'CARD', reason: ' Because ' });
  expect(result.errors).toEqual({});
  expect(result.values).toEqual({
    component_id: component.id,
    sessions: 2,
    method: 'CARD',
    reason: 'Because',
  });
  expect(refundPackageBody({ ...base, sessions: 2, method: 'CARD', reason: ' Because ' })).toEqual({
    component_id: component.id,
    sessions: 2,
    method: 'CARD',
    reason: 'Because',
  });
});

it.each([
  [{ code: 'FORBIDDEN', status: 403 }, 'packageRefund.errorForbidden'],
  [{ code: 'FEATURE_DISABLED', status: 403 }, 'packageRefund.errorFeatureDisabled'],
  [{ code: 'PACKAGE_NOT_FOUND', status: 404 }, 'packageRefund.errorNotFound'],
  [{ code: 'PACKAGE_COMPONENT_NOT_FOUND', status: 422 }, 'packageRefund.errorComponentNotFound'],
  [{ code: 'INSUFFICIENT_SLOTS', status: 422 }, 'packageRefund.errorInsufficientSlots'],
  [{ code: 'PACKAGE_EXPIRED', status: 422 }, 'packageRefund.errorExpired'],
  [{ code: 'IMPORTED_REFUND_DISABLED', status: 422 }, 'packageRefund.errorImportedDisabled'],
  [{ code: 'PACKAGE_REFUND_REASON_INVALID', status: 422 }, 'packageRefund.errorReasonInvalid'],
  [{ code: 'VALIDATION_FAILED', status: 400 }, 'packageRefund.errorValidation'],
  [{}, 'packageRefund.errorNetwork'],
  [{ status: 408 }, 'packageRefund.errorNetwork'],
  [{ status: 429 }, 'packageRefund.errorNetwork'],
  [{ code: 'OTHER', status: 500 }, 'packageRefund.errorGeneric'],
] as const)('maps API error %o to %s', (error, expected) => {
  expect(refundErrorMessageKey(error)).toBe(expected);
});
