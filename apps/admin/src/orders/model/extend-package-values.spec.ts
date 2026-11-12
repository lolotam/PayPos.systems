import { expect, it } from 'vitest';
import {
  extendErrorMessageKey,
  extendPackageResolver,
  extendPackageStale,
  nextDay,
  type ExtendPackageFormValues,
} from './extend-package-values';

const base: ExtendPackageFormValues = {
  new_expires_on: '2027-01-01',
  expected_expires_on: '2026-12-31',
  reason: 'Synthetic reason',
};

function resolve(values: ExtendPackageFormValues) {
  const result = extendPackageResolver()(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  });
  if (result instanceof Promise) throw new Error('Expected the synchronous extension resolver');
  return result;
}

it.each([
  ['2026-01-31', '2026-02-01'],
  ['2026-12-31', '2027-01-01'],
  ['2026-02-28', '2026-03-01'],
  ['2024-02-28', '2024-02-29'],
  ['2024-02-29', '2024-03-01'],
])('nextDay advances %s to %s using calendar strings only', (input, expected) => {
  expect(nextDay(input)).toBe(expected);
});

it.each(['', 'not-a-date', '2026-02-30', '2026-13-01'])(
  'rejects invalid calendar date %s and reports reason errors together',
  (new_expires_on) => {
    const result = resolve({ ...base, new_expires_on, reason: ' \t\r\n ' });
    expect(result.errors.new_expires_on).toEqual({ type: 'custom', message: 'dateRequired' });
    expect(result.errors.reason).toEqual({ type: 'custom', message: 'reasonRequired' });
  },
);

it.each(['2026-12-31', '2026-12-30'])(
  'rejects new expiry %s unless it is strictly later than the current expiry',
  (new_expires_on) => {
    expect(resolve({ ...base, new_expires_on }).errors.new_expires_on)
      .toEqual({ type: 'custom', message: 'dateNotLater' });
  },
);

it('trims only space, tab, CR and LF and accepts exactly 500 code points', () => {
  const reason = ` \t\r\n${'a'.repeat(500)} \t\r\n `;
  const result = resolve({ ...base, reason });
  expect(result.errors).toEqual({});
  expect(result.values).toEqual({ ...base, reason: 'a'.repeat(500) });
});

it('counts astral characters as code points and refuses 501', () => {
  expect(resolve({ ...base, reason: '😀'.repeat(500) }).errors).toEqual({});
  expect(resolve({ ...base, reason: '😀'.repeat(501) }).errors.reason)
    .toEqual({ type: 'custom', message: 'reasonTooLong' });
});

it.each([
  [{ code: 'PACKAGE_EXPIRY_STALE', status: 409 }, 'packageExtension.errorStale'],
  [{ code: 'PACKAGE_EXTENSION_NOT_LATER', status: 422 }, 'packageExtension.errorNotLater'],
  [{ code: 'PACKAGE_EXTENSION_TOO_LONG', status: 422 }, 'packageExtension.errorTooLong'],
  [{ code: 'PACKAGE_EXTENSION_REASON_INVALID', status: 422 }, 'packageExtension.errorReasonInvalid'],
  [{ code: 'VALIDATION_FAILED', status: 400 }, 'packageExtension.errorValidation'],
  [{ code: 'FORBIDDEN', status: 403 }, 'packageExtension.errorForbidden'],
  [{ code: 'FEATURE_DISABLED', status: 403 }, 'packageExtension.errorFeatureDisabled'],
  [{ code: 'PACKAGE_NOT_FOUND', status: 404 }, 'packageExtension.errorNotFound'],
  [{}, 'packageExtension.errorNetwork'],
  [{ status: 408 }, 'packageExtension.errorNetwork'],
  [{ status: 429 }, 'packageExtension.errorNetwork'],
  [{ code: 'OTHER', status: 500 }, 'packageExtension.errorGeneric'],
] as const)('maps API error %o to %s', (error, expected) => {
  expect(extendErrorMessageKey(error)).toBe(expected);
});

it('recognizes only the stale expiry conflict', () => {
  expect(extendPackageStale({ code: 'PACKAGE_EXPIRY_STALE', status: 409 })).toBe(true);
  expect(extendPackageStale({ code: 'IDEMPOTENCY_KEY_IN_PROGRESS', status: 409 })).toBe(false);
});
