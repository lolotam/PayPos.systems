import {
  serviceLineChanged,
  serviceSessionLinesAdded,
  serviceSessionRecorded,
} from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';
import type { ScheduleRatingRequest } from '../../use-cases/schedule-rating-request/schedule-rating-request.ts';

/** الحدث مجرد محفز؛ تُقرأ هوية الزيارة منه ثم تُعاد الجدولة من الحالة الموثوقة. */
export async function onServiceSessionEvent(
  useCase: ScheduleRatingRequest,
  tx: Tx,
  event: ClaimedEvent,
): Promise<void> {
  const schema =
    event.eventType === 'ServiceSessionRecorded'
      ? serviceSessionRecorded
      : event.eventType === 'ServiceSessionLinesAdded'
        ? serviceSessionLinesAdded
        : serviceLineChanged;
  const parsed = schema.safeParse(event.payload);
  if (
    !parsed.success ||
    event.aggregateType !== 'service_session' ||
    parsed.data.session_id !== event.aggregateId
  )
    throw new Error('RATING_SCHEDULE_EVENT_INVALID');
  await useCase.execute(tx, {
    companyId: event.companyId,
    businessId: parsed.data.business_id,
    customerId: parsed.data.customer_id,
    branchId: parsed.data.branch_id,
    occurredAt: new Date(parsed.data.occurred_at),
  });
}
