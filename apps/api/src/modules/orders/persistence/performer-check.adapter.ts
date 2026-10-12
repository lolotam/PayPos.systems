import type { Tx } from '@pospay/db';
import { readSessionPerformers } from '../../staff/index.ts';
import type { PerformerCheckPort } from '../ports/session-readers.port.ts';
export function performerCheck(tx: Tx, companyId: string, businessId: string, branchId: string): PerformerCheckPort {
  return { lock: async (ids) => { await readSessionPerformers(tx, companyId, businessId, branchId, ids, new Date(0), true); },
    read: async (ids, at) => Array.from(await readSessionPerformers(tx, companyId, businessId, branchId, ids, at)) };
}
