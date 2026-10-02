import { describe, expect, it } from 'vitest';

import { PackageRuleError } from '../errors.js';
import { assertPackageNotExpired } from '../package-expiry.js';

describe('branch-local package expiry (PKG-09/M7)', () => {
  it.each([
    ['2026-10-01', '2026-10-02'],
    ['2026-10-02', '2026-10-02'],
    ['2026-12-31', '2027-01-01'],
    ['2024-02-29', '2024-02-29'],
  ])('allows %s through expiry %s', (today, expiresOn) => {
    expect(() => assertPackageNotExpired(today, expiresOn)).not.toThrow();
  });

  it.each([
    ['2026-10-03', '2026-10-02'],
    ['2027-01-01', '2026-12-31'],
    ['2026-03-01', '2026-02-28'],
  ])('rejects %s after expiry %s', (today, expiresOn) => {
    expect(() => assertPackageNotExpired(today, expiresOn)).toThrow(
      new PackageRuleError('PACKAGE_EXPIRED'),
    );
  });

  it('uses an extended expires_on and does not read the process clock', () => {
    expect(() => assertPackageNotExpired('2026-10-03', '2026-10-02')).toThrow(PackageRuleError);
    expect(() => assertPackageNotExpired('2026-10-03', '2026-10-04')).not.toThrow();
  });

  it.each([
    '',
    '2026-2-01',
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-01-00',
    '2026-10-02T23:59:59Z',
    ' 2026-10-02',
    '2026-10-02 ',
  ])('rejects invalid date %s', (value) => {
    expect(() => assertPackageNotExpired(value, '2026-10-02')).toThrow(
      new PackageRuleError('INVALID_DATE'),
    );
    expect(() => assertPackageNotExpired('2026-10-02', value)).toThrow(
      new PackageRuleError('INVALID_DATE'),
    );
  });
});
