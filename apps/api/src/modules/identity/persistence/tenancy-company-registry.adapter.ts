import type { Tx } from '@pospay/db';

import { registerCompany } from '../../tenancy/index.ts';
import type { CompanyRegistry } from '../ports/company-registry.port.ts';

// The only file that knows both modules (module-map.md §3): identity's port, tenancy's exported write.
export const tenancyCompanyRegistry: CompanyRegistry = {
  register: async (tx, company) => {
    const registered = await registerCompany(tx as unknown as Tx, company);
    return { createdAt: registered.createdAt };
  },
};
