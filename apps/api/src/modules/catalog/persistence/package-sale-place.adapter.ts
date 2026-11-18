import { packageSalePlace } from '../../tenancy/index.ts';

export function readSellablePackageSalePlace(...args: Parameters<typeof packageSalePlace>) {
  return packageSalePlace(...args);
}
