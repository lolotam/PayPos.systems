import type { Tx } from '@pospay/db';
import { readRatingsReadAccess } from '../../identity/index.ts';
import { describeWorkspaces } from '../../tenancy/index.ts';

/** قراءات قائمة التقييمات من identity وtenancy؛ الشكل معرّف في queries/ratings-list-reads.ts وبيتربط في الوحدة. */
export const ratingsListReads = {
  access: (...args: Parameters<typeof readRatingsReadAccess>) => readRatingsReadAccess(...args),
  branchNames: async (tx: Tx, businessId: string) => {
    const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
    const branches = tree?.businesses.find((b) => b.id === businessId)?.branches ?? [];
    return new Map(branches.map((b) => [b.id, { name_ar: b.name_ar, name_en: b.name_en }]));
  },
};
