import type { Tx } from '@pospay/db';
import {
  lockDiscountApprovalAccess,
  readDiscountApprovalAccess,
} from '../../identity/index.ts';
import type { DiscountApprovalAccessPort } from '../ports/discount-decision.port.ts';

export function discountApprovalAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): DiscountApprovalAccessPort {
  return {
    lock: () => lockDiscountApprovalAccess(tx, companyId),
    read: (at) => readDiscountApprovalAccess(tx, companyId, userId, businessId, branchId, at),
  };
}
