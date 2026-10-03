import type { Tx } from '@pospay/db';

import { readEmployeeDetailAccess } from '../../identity/index.ts';

export function createEmployeeDetailAccess() {
  return {
    check: (tx: Tx, companyId: string, userId: string, businessId: string, branchId: string) =>
      readEmployeeDetailAccess(tx, companyId, userId, businessId, branchId),
  };
}
