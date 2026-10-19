import type { Tx } from '@pospay/db';
import {
  lockServiceSessionCancelAccess,
  lockServiceSessionEditAccess,
  readServiceSessionCancelAccess,
  readServiceSessionEditAccess,
} from '../../identity/index.ts';
import type { SessionEditAccessPort } from '../ports/line-edit.port.ts';

function sessionLineAccess(
  lock: () => Promise<void>,
  read: SessionEditAccessPort['read'],
): SessionEditAccessPort {
  return { lock, read };
}

export function sessionEditAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): SessionEditAccessPort {
  return sessionLineAccess(
    () => lockServiceSessionEditAccess(tx, companyId),
    (at) => readServiceSessionEditAccess(tx, companyId, userId, businessId, branchId, at),
  );
}

export function sessionCancelAccess(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
): SessionEditAccessPort {
  return sessionLineAccess(
    () => lockServiceSessionCancelAccess(tx, companyId),
    (at) => readServiceSessionCancelAccess(tx, companyId, userId, businessId, branchId, at),
  );
}

// قراءة القدرة بلا FOR SHARE؛ قفل الشركة هنا كان هيعلّق قائمة اليوم.
export function sessionCancelCapability(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  at: Date,
): Promise<{ denied: boolean; feature: boolean; eligible: readonly unknown[] }> {
  return readServiceSessionCancelAccess(tx, companyId, userId, businessId, branchId, at);
}
