import { discountApprovedByPerformer } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import type { RequestDiscountSelfApprovalNotice } from '../../use-cases/request-discount-self-approval-notice/request-discount-self-approval-notice.ts';

export async function onDiscountApprovedByPerformer(
  useCase: RequestDiscountSelfApprovalNotice,
  event: ClaimedEvent,
): Promise<void> {
  if (event.eventType !== 'DiscountApprovedByPerformer') return;
  const parsed = discountApprovedByPerformer.safeParse(event.payload);
  if (!parsed.success) throw new Error('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  const payload = parsed.data;
  // سلامة المصدر من مطابقة الحقائق المحفوظة في matchesProposals، لا من اصطلاح غلاف الحدث،
  // فلا اشتراط على aggregateType ولا aggregateId من كاتب 057-6.
  await useCase.execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    businessId: payload.business_id,
    branchId: payload.branch_id,
    decidedBy: payload.decided_by,
    deciderLabelAr: payload.decider_label_ar,
    deciderLabelEn: payload.decider_label_en,
    decidedVia: payload.decided_via,
    proposals: payload.proposals.map((proposal) => ({
      id: proposal.id,
      serviceId: proposal.service_id,
      nameAr: proposal.name_ar,
      nameEn: proposal.name_en,
      effectiveBps: proposal.effective_bps,
    })),
  });
}
