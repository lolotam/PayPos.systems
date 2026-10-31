import { RATING_REQUESTS_DEFAULT_ENABLED } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { RatingRequestsSwitchPort } from '../ports/rating-requests-switch.port.ts';

type StoredSwitch = { readonly requests_enabled: boolean | null };

export const ratingRequestsSwitch: RatingRequestsSwitchPort<Tx> = {
  enabled: async (tx, companyId, businessId) => {
    const rows = await tx.execute<StoredSwitch>(sql`
      SELECT requests_enabled FROM rating_settings
      WHERE company_id = ${companyId} AND business_id = ${businessId}`);
    return rows[0]?.requests_enabled ?? RATING_REQUESTS_DEFAULT_ENABLED;
  },
};
