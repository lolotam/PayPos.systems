import type { Tx } from '@pospay/db';
import { businessTimeZone, describeWorkspaces } from '../../tenancy/index.ts';
import type { SessionPlacePort } from '../ports/session-readers.port.ts';
export async function sessionBranchBelongs(tx: Tx, companyId: string, businessId: string, branchId: string): Promise<boolean> {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  return tree?.id === companyId && tree.businesses.some((business) =>
    business.id === businessId && business.branches.some((branch) => branch.id === branchId));
}
export function sessionPlace(tx: Tx, companyId: string, businessId: string, branchId: string): SessionPlacePort {
  return { read: async () => {
    const [tree,timezone] = await Promise.all([describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]),businessTimeZone(tx, companyId, businessId)]);
    const business = tree?.id === companyId ? tree.businesses.find((b) => b.id === businessId) : undefined;
    if (!business?.branches.some((b) => b.id === branchId && b.is_active)) return null;
    return timezone === null ? null : { timezone };
  } };
}
