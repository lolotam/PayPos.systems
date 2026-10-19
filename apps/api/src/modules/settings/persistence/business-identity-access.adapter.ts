import type { Tx } from '@pospay/db';

import { lockBusinessIdentityAccess, readBusinessIdentityAccess } from '../../identity/index.ts';
import type { BusinessIdentityAccess } from '../ports/business-identity-access.port.ts';

export function createBusinessIdentityAccess(
  tx: Tx,
  companyId: string,
  userId: string,
): BusinessIdentityAccess {
  return {
    check: (businessId) => lockBusinessIdentityAccess(tx, companyId, userId, businessId),
    recheck: (businessId) => readBusinessIdentityAccess(tx, companyId, userId, businessId),
  };
}
