import { describeWorkspaces } from '../../tenancy/index.ts';
import { personalMemberships } from '../../identity/index.ts';
import type { Tx } from '@pospay/db';
export const personalBranchReads = {
  memberships: (tx: Tx, c: { companyId: string; userId: string }, now: Date) =>
    personalMemberships(tx, c.companyId, c.userId, false, now),
  workspaces: async (tx: Tx, businessId: string) => {
    const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
    return (tree?.businesses.find((b) => b.id === businessId)?.branches ?? [])
      .filter((b) => b.is_active)
      .map((b) => ({
        id: b.id,
        name_ar: b.name_ar,
        name_en: b.name_en,
        timezone: b.effective_timezone,
      }));
  },
};
