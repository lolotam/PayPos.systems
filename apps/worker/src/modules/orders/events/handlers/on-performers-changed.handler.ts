import { serviceLineChanged } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import type { RequestPerformersChangeNotice } from '../../use-cases/request-performers-change-notice/request-performers-change-notice.ts';

export async function onPerformersChanged(
  useCase: RequestPerformersChangeNotice,
  event: ClaimedEvent,
): Promise<void> {
  if (otherChangeKind(event.payload)) return;
  const parsed = serviceLineChanged.safeParse(event.payload);
  if (!parsed.success) throw new Error('LINE_PERFORMERS_EVENT_INVALID');
  const line = parsed.data;
  if (event.aggregateType !== 'service_session' || line.session_id !== event.aggregateId)
    throw new Error('LINE_PERFORMERS_EVENT_INVALID');
  const change = line.change;
  if (change === undefined || change.kind !== 'PERFORMERS_CHANGE') return;
  await useCase.execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    sessionId: line.session_id,
    lineId: line.line_id,
    revision: line.revision,
    businessId: line.business_id,
    branchId: line.branch_id,
    businessDate: line.business_date,
    lineNet: line.net,
    performers: line.performers,
    previousRevision: change.previous.revision,
    previousPerformers: change.previous.performers,
  });
}
// نوع تغيير آخر قد يحمل شكلًا مختلفًا (كتعديل السعر أو الإلغاء)، فلا نمرره على مخطط المنفّذين ولا نعدّه حدثًا تالفًا.
function otherChangeKind(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || !('change' in payload)) return false;
  const change = (payload as { change?: unknown }).change;
  if (typeof change !== 'object' || change === null || !('kind' in change)) return false;
  const kind = (change as { kind?: unknown }).kind;
  return typeof kind === 'string' && kind !== 'PERFORMERS_CHANGE';
}
