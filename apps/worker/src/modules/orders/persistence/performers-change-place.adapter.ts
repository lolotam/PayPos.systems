import type { Tx } from '@pospay/db';
import { branchPlace } from '../../tenancy/index.ts';
import type { PerformersChangeNoticePlace } from '../ports/performers-change-notice.port.ts';

export function performersChangePlace(tx: Tx): PerformersChangeNoticePlace {
  return {
    branchPlace: async (line) => {
      const place = await branchPlace(tx, line.companyId, line.businessId, line.branchId);
      return place === null ? null : { nameAr: place.nameAr, nameEn: place.nameEn };
    },
  };
}
