import {
  serviceLineChanged,
  serviceSessionLinesAdded,
  serviceSessionRecorded,
} from '@pospay/contracts';
import type { ClaimedEvent, Tx } from '@pospay/db';
import type { ScheduleRatingRequest } from '../../use-cases/schedule-rating-request/schedule-rating-request.ts';

// المنتج الحقيقي بيضمّ الأحداث التلاتة بنفس aggregateType ومعرّف الجلسة:
// apps/api/src/modules/orders/persistence/service-session-transactions.ts وline-write-transactions.ts.
const EXPECTED_AGGREGATE: Record<string, string> = {
  ServiceSessionRecorded: 'service_session',
  ServiceSessionLinesAdded: 'service_session',
  ServiceLineChanged: 'service_session',
};

/** الحدث مجرد محفز؛ تُقرأ هوية الزيارة منه ثم تُعاد الجدولة من الحالة الموثوقة. */
export async function onServiceSessionEvent(
  useCase: ScheduleRatingRequest,
  tx: Tx,
  event: ClaimedEvent,
): Promise<void> {
  const schema = schemaOf(event.eventType);
  const parsed = schema === null ? null : schema.safeParse(event.payload);
  if (
    parsed === null ||
    !parsed.success ||
    event.aggregateType !== EXPECTED_AGGREGATE[event.eventType] ||
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

function schemaOf(eventType: string) {
  if (eventType === 'ServiceSessionRecorded') return serviceSessionRecorded;
  if (eventType === 'ServiceSessionLinesAdded') return serviceSessionLinesAdded;
  if (eventType === 'ServiceLineChanged') return serviceLineChanged;
  return null;
}
