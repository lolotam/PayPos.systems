import { describeWorkspaces } from '../../tenancy/index.ts';
import type { AttendanceBoardContext } from '../ports/attendance-board-context.port.ts';

export const attendanceBoardContext: AttendanceBoardContext = async (
  tx,
  companyId,
  rawBusinessId,
  rawBranchId,
) => {
  const businessId = rawBusinessId.toLowerCase();
  const branchId = rawBranchId.toLowerCase();
  const tree = await describeWorkspaces(tx, [{ scope: 'BRANCH', scopeId: branchId }]);
  if (tree?.id !== companyId) return null;
  const business = tree.businesses.find((candidate) => candidate.id === businessId);
  const branch = business?.branches.find((candidate) => candidate.id === branchId);
  return business && branch
    ? { companyId, businessId: business.id, branchId, timezone: branch.effective_timezone }
    : null;
};
