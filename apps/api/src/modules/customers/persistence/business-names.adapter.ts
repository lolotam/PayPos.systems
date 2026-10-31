import { businessNames as readBusinessNames } from '../../tenancy/index.ts';
import type { BusinessNamesPort } from '../ports/business-names.port.ts';

export const businessNames: BusinessNamesPort = {
  names: (tx, companyId, businessId) => readBusinessNames(tx, companyId, businessId),
};
