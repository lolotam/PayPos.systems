import {
  RATING_CLAIMS_DISCOVERY,
  RATING_CLAIMS_DISCOVERY_AGGREGATE,
  ratingClaimsDiscoveryPayload,
} from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';

/** يمنع live وreplay من قبول اكتشاف على aggregate آخر أو بحمولة غير فارغة. */
export function validRatingClaimsDiscovery(event: ClaimedEvent): boolean {
  return (
    event.eventType === RATING_CLAIMS_DISCOVERY &&
    event.aggregateType === RATING_CLAIMS_DISCOVERY_AGGREGATE &&
    event.aggregateId === event.companyId &&
    ratingClaimsDiscoveryPayload.safeParse(event.payload).success
  );
}
