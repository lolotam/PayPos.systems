import type { Tx } from '@pospay/db';
import { lockServiceSessionEditAccess, readServiceSessionEditAccess } from '../../identity/index.ts';
import type { SessionEditAccessPort } from '../ports/line-edit.port.ts';

export function sessionEditAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): SessionEditAccessPort {
  return {
    lock: () => lockServiceSessionEditAccess(tx, companyId),
    read: (at) => readServiceSessionEditAccess(tx, companyId, userId, businessId, branchId, at),
  };
}
