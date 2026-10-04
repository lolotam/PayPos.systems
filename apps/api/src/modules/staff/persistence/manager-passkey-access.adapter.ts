import type { Tx } from '@pospay/db';
import { lockPasskeyAccess, readPasskeyAccess } from '../../identity/index.ts';
import { describeWorkspaces } from '../../tenancy/index.ts';
export function createManagerPasskeyAccess() {
  return {
    lock: (tx: Tx, companyId: string) => lockPasskeyAccess(tx, companyId),
    check: (
      tx: Tx,
      companyId: string,
      userId: string,
      businessId: string,
      branchIds: readonly string[],
    ) => readPasskeyAccess(tx, companyId, userId, businessId, branchIds),
    list: async (tx: Tx, companyId: string, userId: string, businessId: string) => {
      const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
      const branches =
        tree?.id === companyId
          ? (tree.businesses
              .find((business) => business.id === businessId)
              ?.branches.map((branch) => branch.id) ?? [])
          : [];
      return readPasskeyAccess(tx, companyId, userId, businessId, branches);
    },
  };
}
