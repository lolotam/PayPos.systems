import type { Tx } from '@pospay/db';

import { lockImportedRefundsAccess, readImportedRefundsAccess } from '../../identity/index.ts';
import type { ImportedRefundsAccess } from '../ports/imported-refunds-access.port.ts';

export function createImportedRefundsAccess(
  tx: Tx,
  companyId: string,
  userId: string,
): ImportedRefundsAccess {
  return {
    check: (businessId) => lockImportedRefundsAccess(tx, companyId, userId, businessId),
    recheck: (businessId) => readImportedRefundsAccess(tx, companyId, userId, businessId),
  };
}
