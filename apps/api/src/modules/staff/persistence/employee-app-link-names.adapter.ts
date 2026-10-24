import type { Tx } from '@pospay/db';
import { describeWorkspaces } from '../../tenancy/index.ts';
import type { EmployeeAppLinkNames } from '../ports/employee-app-link-names.port.ts';

export function employeeAppLinkNames(tx: Tx): EmployeeAppLinkNames {
  return {
    async business(companyId, businessId) {
      const id = businessId.toLowerCase();
      const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: id }]);
      if (tree?.id !== companyId) return null;
      const business = tree.businesses.find((candidate) => candidate.id === id);
      if (!business) return null;
      return { id: business.id, name_en: business.name_en, name_ar: business.name_ar };
    },
  };
}
