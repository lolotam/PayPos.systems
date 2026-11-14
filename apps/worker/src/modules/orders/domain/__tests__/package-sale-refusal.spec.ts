import { expect, it } from 'vitest';
import type { PackageErrorCode } from '@pospay/domain';
import {
  packageSaleRefusalCode as contractRefusalCode,
  packageSaleWorkerOnlyCodes,
} from '@pospay/contracts';
import { errorMessages, type ErrorMessageCode } from '@pospay/i18n';
import { packageSaleRefusalCode } from '../package-sale-refusal.ts';

const ALL: PackageErrorCode[] = Object.keys({
  INVALID_PRICE: true,
  INVALID_COMPONENTS: true,
  DUPLICATE_SERVICE: true,
  INVALID_SESSIONS: true,
  INVALID_REMAINING_SESSIONS: true,
  INVALID_SLOTS: true,
  INVALID_DATE: true,
  PACKAGE_EXPIRED: true,
  PACKAGE_EXTENSION_NOT_LATER: true,
  PACKAGE_EXTENSION_TOO_LONG: true,
  INSUFFICIENT_SLOTS: true,
} satisfies Record<PackageErrorCode, true>) as PackageErrorCode[];

const EXPECTED_MAPPINGS: Record<PackageErrorCode, string | null> = {
  INVALID_PRICE: 'PACKAGE_TYPE_PRICE_INVALID',
  INVALID_COMPONENTS: 'PACKAGE_TYPE_INVALID_COMPONENTS',
  DUPLICATE_SERVICE: 'PACKAGE_TYPE_DUPLICATE_SERVICE',
  INVALID_SESSIONS: 'PACKAGE_TYPE_INVALID_SESSIONS',
  INVALID_SLOTS: 'PACKAGE_TYPE_INVALID_SESSIONS',
  INVALID_DATE: 'PACKAGE_TYPE_VALIDITY_INVALID',
  INVALID_REMAINING_SESSIONS: null,
  PACKAGE_EXPIRED: null,
  PACKAGE_EXTENSION_NOT_LATER: null,
  PACKAGE_EXTENSION_TOO_LONG: null,
  INSUFFICIENT_SLOTS: null,
};

it('maps every domain error code to the expected public code from the plan table', () => {
  for (const code of ALL) {
    expect(packageSaleRefusalCode(code)).toBe(EXPECTED_MAPPINGS[code]);
  }
});

it('returns null for the five unreachable domain rule codes', () => {
  const nullCodes: PackageErrorCode[] = [
    'INVALID_REMAINING_SESSIONS',
    'PACKAGE_EXPIRED',
    'PACKAGE_EXTENSION_NOT_LATER',
    'PACKAGE_EXTENSION_TOO_LONG',
    'INSUFFICIENT_SLOTS',
  ];
  for (const code of nullCodes) {
    expect(packageSaleRefusalCode(code)).toBeNull();
  }
});

it('maps reachable domain rule errors to contract refusal codes with localized messages', () => {
  for (const domainCode of ALL) {
    const code = packageSaleRefusalCode(domainCode);
    if (code !== null) {
      expect(contractRefusalCode.options).toContain(code);
      if (!(packageSaleWorkerOnlyCodes as readonly string[]).includes(code)) {
        // PACKAGE_SALE_FAILED is the only contract enum member without an i18n message: exclude worker-only codes.
        const messages = errorMessages(code as ErrorMessageCode);
        expect(messages.message_ar.length).toBeGreaterThan(0);
        expect(messages.message_en.length).toBeGreaterThan(0);
      }
    }
  }
});
