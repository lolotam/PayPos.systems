import type { Tx } from '@pospay/db';
import { readServiceSessionAccess } from '../../identity/index.ts';
import { readEffectiveDiscountLimit } from '../../settings/index.ts';

export function recordingAccess(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string, at: Date) {
  return readServiceSessionAccess(tx, companyId, userId, businessId, branchId, at);
}
export async function recordingLimit(tx: Tx, companyId: string, businessId: string, membershipId: string) {
  const limit = await readEffectiveDiscountLimit(tx, companyId, businessId, membershipId);
  switch (limit.status) {
    case 'MEMBERSHIP_NOT_FOUND': return null;
    case 'UNLIMITED': return { source: 'OWNER' as const, bps: null };
    case 'NOT_CONFIGURED': return { source: 'NOT_CONFIGURED' as const, bps: 0 as const };
    case 'SET': return { source: limit.source, bps: limit.limit_bps };
  }
}
