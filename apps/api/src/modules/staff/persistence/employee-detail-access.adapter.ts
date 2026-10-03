import type { Tx } from '@pospay/db';

import { readEmployeeDetailAccess, readEmployeeBranchAccess } from '../../identity/index.ts';
import { describeWorkspaces } from '../../tenancy/index.ts';

export function createEmployeeDetailAccess() {
  return {
    listScope: async (tx: Tx, companyId: string, userId: string, businessId: string) => {
      const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
      const branchIds =
        tree?.businesses
          .find((business) => business.id === businessId)
          ?.branches.map((branch) => branch.id) ?? [];
      return readEmployeeBranchAccess(tx, companyId, userId, businessId, branchIds);
    },
    checkMany: (
      tx: Tx,
      companyId: string,
      userId: string,
      businessId: string,
      branchIds: readonly string[],
    ) => readEmployeeBranchAccess(tx, companyId, userId, businessId, branchIds),
    check: (tx: Tx, companyId: string, userId: string, businessId: string, branchId: string) =>
      readEmployeeDetailAccess(tx, companyId, userId, businessId, branchId),
  };
}
