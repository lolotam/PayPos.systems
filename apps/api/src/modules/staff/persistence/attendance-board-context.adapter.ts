import { canonicalOwnerSql, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { describeWorkspaces } from '../../tenancy/index.ts';

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
  const [actor] = userId
    ? await tx.execute<{ owner: boolean }>(sql`SELECT EXISTS(
    SELECT 1 FROM memberships m WHERE m.company_id=${companyId} AND m.user_id=${userId}
      AND m.starts_at<=now() AND (m.ends_at IS NULL OR m.ends_at>now())
      AND ${canonicalOwnerSql('m', companyId)}) AS owner`)
    : [];
  return {
    companyId,
    businessId: business.id,
    branchId,
    timezone: branch.effective_timezone,
    ...(userId ? { userId, owner: actor?.owner === true } : {}),
  };
}
