import type { Tx } from '@pospay/db';
import { branchPlace } from '../../tenancy/index.ts';
import type { DiscountApprovalNoticePlace } from '../ports/discount-approval-notice.port.ts';

export function discountApprovalPlace(tx: Tx): DiscountApprovalNoticePlace {
  return {
    branchPlace: async (request) => {
      const place = await branchPlace(tx, request.companyId, request.businessId, request.branchId);
      return place === null ? null : { nameAr: place.nameAr, nameEn: place.nameEn };
    },
  };
}
