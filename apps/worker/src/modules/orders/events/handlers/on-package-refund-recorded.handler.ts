import { packageRefundRecorded } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import type { RequestPackageRefundNotice } from '../../use-cases/request-package-refund-notice/request-package-refund-notice.ts';

export async function onPackageRefundRecorded(
  useCase: RequestPackageRefundNotice,
  event: ClaimedEvent,
): Promise<void> {
  const parsed = packageRefundRecorded.safeParse(event.payload);
  if (!parsed.success) throw new Error('PACKAGE_REFUND_EVENT_INVALID');
  const payload = parsed.data;
  // الحدث بيحمل الاستحقاق نفسه: aggregate نوعه استحقاق باقة ومعرّفه هو معرّف الاستحقاق.
  if (event.aggregateType !== 'package_entitlement' || payload.entitlement_id !== event.aggregateId)
    throw new Error('PACKAGE_REFUND_EVENT_INVALID');
  await useCase.execute({
    companyId: event.companyId,
    sourceEventId: event.id,
    businessId: payload.business_id,
    branchId: payload.branch_id,
    entitlementId: payload.entitlement_id,
    componentId: payload.component_id,
    refundId: payload.refund_id,
    sessions: payload.sessions,
    amount: payload.amount,
    businessDate: payload.business_date,
    refundedAt: payload.refunded_at,
    entitlementRevision: payload.entitlement_revision,
  });
}
