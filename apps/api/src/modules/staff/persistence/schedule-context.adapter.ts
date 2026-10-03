import type { Tx } from '@pospay/db';
import { describeWorkspaces } from '../../tenancy/index.ts';
import { scheduleAccess } from '../../identity/index.ts';

export async function schedulingContext(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string | null,
) {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  const business =
    tree?.id === companyId ? tree.businesses.find((b) => b.id === businessId) : undefined;
  if (!business) return null;
  if (branchId === null) return { timezone: 'Asia/Kuwait' };
  const branch = business.branches.find((b) => b.id === branchId && b.is_active);
  return branch ? { timezone: branch.effective_timezone } : null;
}
export function schedulingAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string | null,
  action: 'read' | 'manage',
  lock = false,
) {
  return scheduleAccess(tx, companyId, userId, { businessId, branchId, action }, lock);
}
