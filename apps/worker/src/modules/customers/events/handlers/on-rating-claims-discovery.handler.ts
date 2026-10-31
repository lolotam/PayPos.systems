import { ratingClaimsDiscoveryRequested } from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';
import type { OutboxConsumer } from '../../../../outbox/consumer.ts';

/**
 * يقرّ حدث «اكتشف الطلبات المستحقة» بلا شغل على الداتابيز.
 *
 * تسجيل جدولة المطالبة بيحصل في مسار التسليم قبل المعاملة (Redis بره المعاملة، ADR-0037)،
 * فالمستهلك هنا وظيفته إن الـ dispatcher يعرف نوع الحدث ومايوقفشDelivery عند حدث مجهول.
 */
export function ratingClaimsDiscoveryConsumer(): OutboxConsumer {
  return {
    id: 'customers.rating-claims-discovery-v1',
    eventTypes: ['RatingClaimsDiscoveryRequested'],
    handle: async (_tx: Tx, event: ClaimedEvent) => {
      const parsed = ratingClaimsDiscoveryRequested.safeParse(event.payload);
      if (!parsed.success || parsed.data.company_id !== event.companyId)
        throw new Error('RATING_CLAIMS_DISCOVERY_EVENT_INVALID');
    },
  };
}
