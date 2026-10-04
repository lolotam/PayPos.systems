import type { Tx } from '@pospay/db';
import { lockLeaveAccess, readLeaveAccess } from '../../identity/index.ts';
import { describeWorkspaces } from '../../tenancy/index.ts';
export const leaveAuthorityLock = (tx: Tx, companyId: string) => lockLeaveAccess(tx, companyId);
export const leaveAuthority = (
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchIds: readonly string[],
  subjectUserId?: string,
) => readLeaveAccess(tx, companyId, userId, businessId, branchIds, subjectUserId);
export async function leaveBusinessContext(tx: Tx, companyId: string, businessId: string) {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  return tree?.id === companyId ? (tree.businesses.find((b) => b.id === businessId) ?? null) : null;
}
