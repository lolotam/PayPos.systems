import type { Tx } from '@pospay/db';
import { activeBusinessTimeZone, describeWorkspaces, packageSalePlace } from '../../tenancy/index.ts';
import type { SessionPlacePort } from '../ports/session-readers.port.ts';

export async function sessionBranchBelongs(tx: Tx, companyId: string, businessId: string, branchId: string): Promise<boolean> {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  return tree?.id === companyId && tree.businesses.some((business) =>
    business.id === businessId && business.branches.some((branch) => branch.id === branchId));
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
    branchTimezone: async () => packageSalePlace(tx, companyId, businessId, branchId),
  };
}

export async function sessionRecordingPlace(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<{ timezone: string; branchTimezone: string } | null> {
  const currentPlace = sessionPlace(tx, companyId, businessId, branchId);
  const business = await currentPlace.read();
  if (business === null) return null;
  const branchTimezone = await currentPlace.branchTimezone();
  return branchTimezone === null ? null : { timezone: business.timezone, branchTimezone };
}
