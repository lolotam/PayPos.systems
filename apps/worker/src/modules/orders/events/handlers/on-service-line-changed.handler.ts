import { serviceLineChanged } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import type { RequestPriceEditNotice } from '../../use-cases/request-price-edit-notice/request-price-edit-notice.ts';

export async function onServiceLineChanged(
  useCase: RequestPriceEditNotice,
  event: ClaimedEvent,
): Promise<void> {
  const parsed = serviceLineChanged.safeParse(event.payload);
  if (!parsed.success) {
    // المخطط لا يقبل إلا PRICE_DISCOUNT_EDIT؛ نوع آخر سليم الشكل يُتجاهل بدل رفضه كحدث تالف.
    if (otherPriceKind(event.payload)) return;
    throw new Error('PRICE_EDIT_EVENT_INVALID');
  }
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
function otherPriceKind(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null || !('change' in payload)) return false;
  const change = (payload as { change?: unknown }).change;
  if (typeof change !== 'object' || change === null || !('kind' in change)) return false;
  const kind = (change as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || kind === 'PRICE_DISCOUNT_EDIT') return false;
  return serviceLineChanged.safeParse({
    ...payload,
    change: { ...change, kind: 'PRICE_DISCOUNT_EDIT' },
  }).success;
}
