import { z } from 'zod';

export const packageSaleRefusalCode = z
  .enum([
    'PACKAGE_TYPE_NOT_FOUND',
    'PACKAGE_TYPE_REVISION_CONFLICT',
    'PACKAGE_TYPE_NOT_SELLABLE',
    'PACKAGE_SALE_QUOTE_STALE',
    'PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT',
    'PACKAGE_SELLER_NOT_ELIGIBLE',
    'PACKAGE_SELLER_SELF_FORBIDDEN',
    'PACKAGE_SALE_TOO_OLD',
    'PACKAGE_SALE_IN_FUTURE',
    'PACKAGE_SALE_BRANCH_INACTIVE',
    'PACKAGE_CUSTOMER_NOT_FOUND',
    'PACKAGE_TYPE_INVALID_COMPONENTS',
    'PACKAGE_TYPE_DUPLICATE_SERVICE',
    'PACKAGE_TYPE_INVALID_SESSIONS',
    'PACKAGE_TYPE_PRICE_INVALID',
    'PACKAGE_TYPE_VALIDITY_INVALID',
    'PACKAGE_SALE_FAILED',
  ])
  .meta({ id: 'PackageSaleRefusalCode' });

export type PackageSaleRefusalCode = z.infer<typeof packageSaleRefusalCode>;

// نتائج نهائية يقرأها الـ worker من حالة البيع، وليست حالات HTTP أبدًا.
export const packageSaleWorkerOnlyCodes = [
  'PACKAGE_SALE_BRANCH_INACTIVE',
  'PACKAGE_SALE_FAILED',
] as const satisfies readonly PackageSaleRefusalCode[];
