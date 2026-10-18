import type { Tx } from '@pospay/db';
import { branchPlace } from '../../tenancy/index.ts';
import type { LineCancelNoticePlace } from '../ports/line-cancel-notice.port.ts';

export function lineCancelPlace(tx: Tx): LineCancelNoticePlace {
  return {
    branchPlace: async (line) => {
      const place = await branchPlace(tx, line.companyId, line.businessId, line.branchId);
      return place === null ? null : { nameAr: place.nameAr, nameEn: place.nameEn };
    },
  };
}
