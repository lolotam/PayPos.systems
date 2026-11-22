import { lowRatingSubmitted } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import type { RequestLowRatingNotice } from '../../use-cases/request-low-rating-notice/request-low-rating-notice.ts';

export async function onLowRatingSubmitted(
  useCase: RequestLowRatingNotice,
  event: ClaimedEvent,
): Promise<void> {
  const parsed = lowRatingSubmitted.safeParse(event.payload);
  if (
    !parsed.success ||
    event.aggregateType !== 'rating' ||
    parsed.data.rating_id !== event.aggregateId
  )
    throw new Error('LOW_RATING_EVENT_INVALID');
  await useCase.execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    ratingId: parsed.data.rating_id,
    requestId: parsed.data.request_id,
    businessId: parsed.data.business_id,
    branchId: parsed.data.branch_id,
    stars: parsed.data.stars,
  });
}
