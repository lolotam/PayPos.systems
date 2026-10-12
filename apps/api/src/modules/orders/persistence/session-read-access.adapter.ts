import type { Tx } from '@pospay/db';
import { readServiceSessionReadAccess } from '../../identity/index.ts';

export function sessionReadAccess(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string) {
  return readServiceSessionReadAccess(tx, companyId, userId, businessId, branchId);
}
