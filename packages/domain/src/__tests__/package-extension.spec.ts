import { describe, expect, it } from 'vitest';

import { PackageRuleError } from '../packages/errors.js';
import {
  assertPackageExtensionAllowed,
  packageExtensionLimit,
} from '../packages/package-extension.js';

function expectRuleError(work: () => void, code: PackageRuleError['code']): void {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(PackageRuleError);
    expect((error as PackageRuleError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('packageExtensionLimit', () => {
  it.each([
    ['2026-10-21', '2028-10-21'],
    ['2028-02-29', '2030-02-28'],
    ['2024-02-29', '2026-02-28'],
    ['2032-02-29', '2034-02-28'],
    ['2022-02-28', '2024-02-28'],
    ['2026-12-31', '2028-12-31'],
  ])('adds two calendar years to %s without rolling into March', (today, expected) => {
    expect(packageExtensionLimit(today)).toBe(expected);
  });

  it.each(['2026-13-01', '2026-1-1', '2026-02-30', 'not-a-date'])(
    'rejects invalid date %s',
    (today) => {
      expectRuleError(() => packageExtensionLimit(today), 'INVALID_DATE');
    },
  );
});

describe('assertPackageExtensionAllowed', () => {
  it.each(['2026-12-30', '2026-12-29'])(
    'refuses new expiry %s that is not later than the current expiry',
    (newExpiresOn) => {
      expectRuleError(
        () => assertPackageExtensionAllowed('2026-10-21', '2026-12-30', newExpiresOn),
        'PACKAGE_EXTENSION_NOT_LATER',
      );
    },
  );

  it('accepts one day later and exactly the two-year limit', () => {
    expect(() =>
      assertPackageExtensionAllowed('2026-10-21', '2026-12-30', '2026-12-31'),
    ).not.toThrow();
    expect(() =>
      assertPackageExtensionAllowed('2026-10-21', '2026-12-30', '2028-10-21'),
    ).not.toThrow();
  });

  it('refuses one day beyond the two-year limit', () => {
    expectRuleError(
      () => assertPackageExtensionAllowed('2026-10-21', '2026-12-30', '2028-10-22'),
      'PACKAGE_EXTENSION_TOO_LONG',
    );
  });

  it('allows an expired package to move later, even when the new date remains in the past', () => {
    expect(() =>
      assertPackageExtensionAllowed('2026-10-21', '2026-10-01', '2026-10-15'),
    ).not.toThrow();
  });

  it.each([
    ['2026-1-1', '2026-12-30', '2026-12-31'],
    ['2026-10-21', '2026-02-30', '2026-12-31'],
    ['2026-10-21', '2026-12-30', '2028-13-01'],
  ])('rejects an invalid date in every argument position', (today, current, next) => {
    expectRuleError(() => assertPackageExtensionAllowed(today, current, next), 'INVALID_DATE');
  });
});
