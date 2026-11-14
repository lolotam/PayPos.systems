import { expect, it } from 'vitest';
import { packageSaleRefusalCode, packageSaleWorkerOnlyCodes } from './package-sale-refusal.js';

const expectedCodes = [
  'PACKAGE_CUSTOMER_NOT_FOUND',
  'PACKAGE_SALE_BRANCH_INACTIVE',
  'PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT',
  'PACKAGE_SALE_FAILED',
  'PACKAGE_SALE_IN_FUTURE',
  'PACKAGE_SALE_QUOTE_STALE',
  'PACKAGE_SALE_TOO_OLD',
  'PACKAGE_SELLER_NOT_ELIGIBLE',
  'PACKAGE_SELLER_SELF_FORBIDDEN',
  'PACKAGE_TYPE_DUPLICATE_SERVICE',
  'PACKAGE_TYPE_INVALID_COMPONENTS',
  'PACKAGE_TYPE_INVALID_SESSIONS',
  'PACKAGE_TYPE_NOT_FOUND',
  'PACKAGE_TYPE_NOT_SELLABLE',
  'PACKAGE_TYPE_PRICE_INVALID',
  'PACKAGE_TYPE_REVISION_CONFLICT',
  'PACKAGE_TYPE_VALIDITY_INVALID',
];

it('lists the exact 17 refusal codes in the contract enum', () => {
  expect([...packageSaleRefusalCode.options].sort()).toEqual(expectedCodes);
});

it('matches worker-only codes and ensures each is an enum member', () => {
  expect(packageSaleWorkerOnlyCodes).toEqual([
    'PACKAGE_SALE_BRANCH_INACTIVE',
    'PACKAGE_SALE_FAILED',
  ]);
  for (const code of packageSaleWorkerOnlyCodes) {
    expect(packageSaleRefusalCode.options).toContain(code);
  }
});

