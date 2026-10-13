import type { SessionServiceOptionsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { readSessionServiceOptions } from '../../catalog/index.ts';

export function sessionServiceOptions(tx: Tx, companyId: string, businessId: string, branchId: string, query: SessionServiceOptionsQuery) {
  return readSessionServiceOptions(tx, companyId, businessId, branchId, query);
}
