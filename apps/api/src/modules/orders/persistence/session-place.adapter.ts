import type { Tx } from '@pospay/db';
import { activeBusinessTimeZone, describeWorkspaces } from '../../tenancy/index.ts';
import type { SessionPlacePort } from '../ports/session-readers.port.ts';

export async function sessionBranchBelongs(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<boolean> {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  return (
    tree?.id === companyId &&
    tree.businesses.some(
      (business) =>
        business.id === businessId && business.branches.some((branch) => branch.id === branchId),
    )
  );
}

export function sessionPlace(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): SessionPlacePort {
  return {
    read: async () => {
      const timezone = await activeBusinessTimeZone(tx, companyId, businessId, branchId);
      return timezone === null ? null : { timezone };
    },
  };
}
