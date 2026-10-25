import type { Tx } from '@pospay/db';
import { branchPlace } from '../../tenancy/index.ts';
import type { BranchPlaceReader } from '../ports/branch-place.port.ts';

export const branchPlaceAdapter: BranchPlaceReader<Tx> = {
  forBranch: async (tx, companyId, businessId, branchId) => {
    const place = await branchPlace(tx, companyId, businessId, branchId);
    if (place === null) return null;
    return {
      nameAr: place.nameAr,
      nameEn: place.nameEn,
      timeZone: place.timeZone,
      businessNameAr: place.businessNameAr,
      businessNameEn: place.businessNameEn,
    };
  },
};
