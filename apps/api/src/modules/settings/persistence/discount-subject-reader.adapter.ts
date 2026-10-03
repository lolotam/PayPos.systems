import type { Tx } from '@pospay/db';
import { readMembershipDiscountSubject } from '../../identity/index.ts';
import { businessDiscountScope } from '../../tenancy/index.ts';
import type { DiscountSubjectReader } from '../ports/discount-subject-reader.port.ts';

export function createDiscountSubjectReader(tx: Tx, companyId: string): DiscountSubjectReader {
  return {
    read: async (membershipId, businessId) =>
      readMembershipDiscountSubject(
        tx,
        companyId,
        membershipId,
        await businessDiscountScope(tx, companyId, businessId),
      ),
  };
}
