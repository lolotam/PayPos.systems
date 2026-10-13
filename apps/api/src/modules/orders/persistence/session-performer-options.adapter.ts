import type { SessionPerformerOptionsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { readSessionPerformerOptions } from '../../staff/index.ts';

export function sessionPerformerOptions(tx: Tx, companyId: string, businessId: string, branchId: string, query: SessionPerformerOptionsQuery) {
  return readSessionPerformerOptions(tx, companyId, businessId, branchId, query);
}
