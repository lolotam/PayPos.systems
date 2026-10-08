import { branchPlace } from '../../tenancy/index.ts';
import type { BranchPlaceReader } from '../ports/branch-place.port.ts';

export const branchPlaceAdapter: BranchPlaceReader = {
  forBranch: (tx, companyId, businessId, branchId) =>
    branchPlace(tx, companyId, businessId, branchId),
};
