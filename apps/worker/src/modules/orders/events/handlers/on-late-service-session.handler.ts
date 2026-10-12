import { serviceSessionRecorded, serviceSessionLinesAdded } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import type { RequestLateServiceSessionNotice } from '../../use-cases/request-late-service-session-notice/request-late-service-session-notice.ts';

export async function onLateServiceSession(
  useCase: RequestLateServiceSessionNotice,
  event: ClaimedEvent,
): Promise<void> {
  const schema =
    event.eventType === 'ServiceSessionRecorded'
      ? serviceSessionRecorded
      : serviceSessionLinesAdded;
  const parsed = schema.safeParse(event.payload);
  if (
    !parsed.success ||
    event.aggregateType !== 'service_session' ||
    parsed.data.session_id !== event.aggregateId
  )
    throw new Error('LATE_SESSION_EVENT_INVALID');
  const saved = parsed.data;
  if (
    saved.lines.some(
      (line) =>
        line.session_id !== saved.session_id ||
        line.business_id !== saved.business_id ||
        line.branch_id !== saved.branch_id ||
        line.customer_id !== saved.customer_id ||
        line.business_date !== saved.business_date,
    )
  )
    throw new Error('LATE_SESSION_EVENT_INVALID');
  await useCase.execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    sessionId: saved.session_id,
    businessId: saved.business_id,
    branchId: saved.branch_id,
    businessDate: saved.business_date,
    businessTimezone: saved.business_timezone,
    late: saved.late,
    lines: saved.lines,
  });
}
