import type { Tx } from '@pospay/db';
import { branchPlace } from '../../tenancy/index.ts';
import type { BranchPlaceReader } from '../ports/branch-place.port.ts';

export const branchPlaceAdapter: BranchPlaceReader<Tx> = {
  forBranch: (tx, companyId, businessId, branchId) =>
    branchPlace(tx, companyId, businessId, branchId),
};
