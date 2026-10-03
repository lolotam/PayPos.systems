import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  lockMembershipDiscountSubject,
  readMembershipDiscountSubject,
} from '../../identity/index.ts';
import { businessDiscountScope } from '../../tenancy/index.ts';
import type { DiscountSubjectReader } from '../ports/discount-subject-reader.port.ts';

export function createDiscountSubjectReader(tx: Tx, companyId: string): DiscountSubjectReader {
  return {
    lock: (membershipId) => lockMembershipDiscountSubject(tx, companyId, membershipId),
    read: async (membershipId, businessId) => {
      const business = await businessDiscountScope(tx, companyId, businessId);
      // القراء سبق وانتظروا أقفال الشركة والعضوية والإعدادات؛ now() يحتفظ بوقت قديم قبل الانتظار.
      const [time] = await tx.execute<{ at: string }>(sql`SELECT clock_timestamp()::text AS at`);
      if (time === undefined) throw new Error('Discount eligibility time missing');
      return readMembershipDiscountSubject(tx, companyId, membershipId, business, time.at);
    },
  };
}
