import { serviceLineChanged } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import type { RequestPriceEditNotice } from '../../use-cases/request-price-edit-notice/request-price-edit-notice.ts';

export async function onServiceLineChanged(
  useCase: RequestPriceEditNotice,
  event: ClaimedEvent,
): Promise<void> {
  if (otherChangeKind(event.payload)) return;
  const parsed = serviceLineChanged.safeParse(event.payload);
  if (!parsed.success) throw new Error('PRICE_EDIT_EVENT_INVALID');
  const line = parsed.data;
  if (event.aggregateType !== 'service_session' || line.session_id !== event.aggregateId)
    throw new Error('PRICE_EDIT_EVENT_INVALID');
  const change = line.change;
  if (change === undefined || change.kind !== 'PRICE_DISCOUNT_EDIT') return;
  await useCase.execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    sessionId: line.session_id,
    lineId: line.line_id,
    revision: line.revision,
    businessId: line.business_id,
    branchId: line.branch_id,
    businessDate: line.business_date,
    previousNet: change.previous.net,
    newNet: line.net,
  });
}
// نوع تغيير آخر قد يحمل شكلًا مختلفًا (كالإلغاء)، فلا نمرره على مخطط تعديل السعر ولا نعدّه حدثًا تالفًا.
function otherChangeKind(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || !('change' in payload)) return false;
  const change = (payload as { change?: unknown }).change;
  if (typeof change !== 'object' || change === null || !('kind' in change)) return false;
  const kind = (change as { kind?: unknown }).kind;
  return typeof kind === 'string' && kind !== 'PRICE_DISCOUNT_EDIT';
}
