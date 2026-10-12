import type { Tx } from '@pospay/db';
import { readEffectiveDiscountLimit } from '../../settings/index.ts';
import { SessionError } from '../domain/session-error.ts';
import type { DiscountLimitPort } from '../ports/session-readers.port.ts';
export function discountLimit(tx: Tx, companyId: string, businessId: string): DiscountLimitPort {
  return { read: async (id) => {
    const limit = await readEffectiveDiscountLimit(tx, companyId, businessId, id);
    switch (limit.status) {
      case 'MEMBERSHIP_NOT_FOUND': throw new SessionError('FORBIDDEN');
      case 'UNLIMITED': return { source: 'OWNER', bps: null };
      case 'NOT_CONFIGURED': return { source: 'NOT_CONFIGURED', bps: 0 };
      case 'SET': return { source: limit.source, bps: limit.limit_bps };
      default: { const unreachable: never = limit; throw new Error(`Invalid limit ${unreachable}`); }
    }
  } };
}
