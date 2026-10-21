import type { Tx } from '@pospay/db';

import { readAlertRulesAccess } from '../../identity/index.ts';

export function readBranchAlertRulesAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  target: { businessId: string; branchId: string },
): Promise<'FORBIDDEN' | null> {
  return readAlertRulesAccess(tx, companyId, userId, target);
}
