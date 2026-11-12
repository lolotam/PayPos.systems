import { describe, expect, it } from 'vitest';

import { PackageRuleError } from '../packages/errors.js';
import { assertPackageNotExpired, packageExpiryDate, packageUsableOn } from '../packages/package-expiry.js';

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

describe('packageUsableOn', () => {
  it.each([
    ['2026-10-01', '2026-10-02', true],
    ['2026-10-02', '2026-10-02', true],
    ['2026-10-03', '2026-10-02', false],
    ['2026-11-30', '2026-12-01', true],
    ['2026-12-31', '2027-01-01', true],
    ['2027-01-01', '2026-12-31', false],
    ['2028-02-29', '2028-02-29', true],
    ['2028-03-01', '2028-02-29', false],
  ] as const)('visit %s on expiry %s is %s', (visitDate, expiresOn, expected) => {
    expect(packageUsableOn(visitDate, expiresOn)).toBe(expected);
  });

  it.each([
    ['bad visit format', '2026-2-01', '2026-10-02'],
    ['bad expiry format', '2026-10-02', '2026-2-01'],
    ['impossible visit date', '2026-02-30', '2026-10-02'],
    ['impossible expiry date', '2026-10-02', '2026-02-30'],
  ])('throws INVALID_DATE for %s', (_reason, visitDate, expiresOn) => {
    const usable = () => packageUsableOn(visitDate, expiresOn);

    expect(usable).toThrow(PackageRuleError);
    expect(usable).toThrow(new PackageRuleError('INVALID_DATE'));
  });
});

describe('sale expiry is a calendar addition (FR-017)', () => {
  it.each([
    ['2026-10-01', 90, '2026-12-30'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2024-01-01', 730, '2025-12-31'],
  ] as const)('%s plus %s days expires %s', (soldDate, days, expected) => {
    expect(packageExpiryDate(soldDate, days)).toBe(expected);
  });
  it.each([0, -1, 731, 1.5, NaN, Infinity])('rejects invalid validity %s', (days) => {
    expect(() => packageExpiryDate('2026-10-01', days)).toThrow(
      new PackageRuleError('INVALID_DATE'),
    );
  });
  it.each(['2026-02-29', '2026-2-01', '9999-12-31'])(
    'rejects invalid or overflowing calendar date %s',
    (day) => {
      expect(() => packageExpiryDate(day, 1)).toThrow(new PackageRuleError('INVALID_DATE'));
    },
  );
});
