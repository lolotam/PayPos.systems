import { discountApprovalRequested } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import type { RequestDiscountApprovalNotice } from '../../use-cases/request-discount-approval-notice/request-discount-approval-notice.ts';

export async function onDiscountApprovalRequested(
  useCase: RequestDiscountApprovalNotice,
  event: ClaimedEvent,
): Promise<void> {
  if (event.eventType !== 'DiscountApprovalRequested') return;
  const parsed = discountApprovalRequested.safeParse(event.payload);
  if (!parsed.success) throw new Error('DISCOUNT_APPROVAL_EVENT_INVALID');
  const payload = parsed.data;
  // الحدث يحمل الطلب نفسه: aggregate نوعه طلب موافقة ومعرّفه هو request_id، وإلا فهو حدث آخر.
  if (
    event.aggregateType !== 'discount_approval_request' ||
    payload.request_id !== event.aggregateId
  )
    throw new Error('DISCOUNT_APPROVAL_EVENT_INVALID');
  await useCase.execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    requestId: payload.request_id,
    businessId: payload.business_id,
    branchId: payload.branch_id,
    requestedBy: payload.requested_by,
    lineCount: payload.line_count,
    maxEffectiveBps: payload.max_effective_bps,
    services: payload.services.map((service) => ({
      serviceId: service.service_id,
      nameAr: service.name_ar,
      nameEn: service.name_en,
    })),
  });
}
