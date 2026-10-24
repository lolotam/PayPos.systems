import type { Tx } from '@pospay/db';
import { describeWorkspaces } from '../../tenancy/index.ts';

export function employeeAppLinkNames(tx: Tx) {
  return {
    async business(companyId: string, businessId: string) {
      const id = businessId.toLowerCase();
      const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: id }]);
      if (tree?.id !== companyId) return null;
      const business = tree.businesses.find((candidate) => candidate.id === id);
      if (!business) return null;
      return { id: business.id, name_en: business.name_en, name_ar: business.name_ar };
    },
  };
}
