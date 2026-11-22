import type { Tx } from '@pospay/db';
import { branchPlace, companyOpen } from '../../tenancy/index.ts';
import type { LowRatingPlace } from '../ports/low-rating-notice.ports.ts';

export function lowRatingPlace(tx: Tx): LowRatingPlace {
  return {
    companyOpen: (companyId) => companyOpen(tx, companyId),
    forBranch: async (event) => {
      const place = await branchPlace(tx, event.companyId, event.businessId, event.branchId);
      return place === null ? null : { nameAr: place.nameAr, nameEn: place.nameEn };
    },
  };
}
