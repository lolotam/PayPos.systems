import type { Tx } from '@pospay/db';
import { branchPlace } from '../../tenancy/index.ts';
import type { PriceEditNoticePlace } from '../ports/price-edit-notice.port.ts';

export function priceEditPlace(tx: Tx): PriceEditNoticePlace {
  return {
    branchPlace: async (line) => {
      const place = await branchPlace(tx, line.companyId, line.businessId, line.branchId);
      return place === null ? null : { nameAr: place.nameAr, nameEn: place.nameEn };
    },
  };
}
