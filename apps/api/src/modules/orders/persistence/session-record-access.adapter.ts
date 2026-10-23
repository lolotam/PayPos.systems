import type { Tx } from '@pospay/db';
import { lockServiceSessionAccess, readServiceSessionAccess } from '../../identity/index.ts';
import type { DiscountRequestAccessPort } from '../ports/discount-request.port.ts';
import type { SessionRecordAccessPort } from '../ports/session-readers.port.ts';
export function sessionRecordAccess(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string): SessionRecordAccessPort {
  return { lock: () => lockServiceSessionAccess(tx, companyId),
    read: (at) => readServiceSessionAccess(tx, companyId, userId, businessId, branchId, at) };
}
export function discountRequestAccess(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string): DiscountRequestAccessPort {
  return { lock: () => lockServiceSessionAccess(tx, companyId),
    read: (at) => readServiceSessionAccess(tx, companyId, userId, businessId, branchId, at) };
}
