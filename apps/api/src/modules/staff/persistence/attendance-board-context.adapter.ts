import type { Tx } from '@pospay/db';
import { describeWorkspaces } from '../../tenancy/index.ts';
import { attendanceCorrectionAuthority } from './attendance-correction-context.adapter.ts';

export async function attendanceBoardContext(
  tx: Tx,
  companyId: string,
  rawBusinessId: string,
  rawBranchId: string,
  userId?: string,
) {
  const businessId = rawBusinessId.toLowerCase();
  const branchId = rawBranchId.toLowerCase();
  const tree = await describeWorkspaces(tx, [{ scope: 'BRANCH', scopeId: branchId }]);
  if (tree?.id !== companyId) return null;
  const business = tree.businesses.find((candidate) => candidate.id === businessId);
  const branch = business?.branches.find((candidate) => candidate.id === branchId);
  if (!business || !branch) return null;
  const actor = userId
    ? await attendanceCorrectionAuthority(tx, companyId, userId, business.id, branchId, new Date())
    : undefined;
  return {
    companyId,
    businessId: business.id,
    branchId,
    timezone: branch.effective_timezone,
    ...(userId ? { userId, owner: actor?.owner === true } : {}),
  };
}
