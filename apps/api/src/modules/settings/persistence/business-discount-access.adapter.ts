import type { Tx } from '@pospay/db';
import { lockBusinessDiscountAccess } from '../../identity/index.ts';
import type { BusinessDiscountAccess } from '../ports/business-discount-access.port.ts';

export function createBusinessDiscountAccess(
  tx: Tx,
  companyId: string,
  userId: string,
): BusinessDiscountAccess {
  return { check: (businessId) => lockBusinessDiscountAccess(tx, companyId, userId, businessId) };
}
