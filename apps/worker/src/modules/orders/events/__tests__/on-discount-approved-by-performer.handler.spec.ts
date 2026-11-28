import type { ClaimedEvent } from '@pospay/db';
import { expect, it, vi } from 'vitest';
import type { RequestDiscountSelfApprovalNotice } from '../../use-cases/request-discount-self-approval-notice/request-discount-self-approval-notice.ts';
import { onDiscountApprovedByPerformer } from '../handlers/on-discount-approved-by-performer.handler.ts';

const ids = {
  decision: '01920000-0000-7000-8000-000000000001',
  business: '01920000-0000-7000-8000-000000000002',
  branch: '01920000-0000-7000-8000-000000000003',
  decidedBy: '01920000-0000-7000-8000-000000000004',
  service: '01920000-0000-7000-8000-000000000005',
  company: '01920000-0000-7000-8000-000000000006',
  event: '01920000-0000-7000-8000-000000000007',
};

const basePayload = {
  schema_version: 1,
  business_id: ids.business,
  branch_id: ids.branch,
  decided_by: ids.decidedBy,
  decider_label_en: 'Heba',
  decider_label_ar: 'هبة',
  decided_via: 'PIN',
  proposals: [
    {
      id: ids.decision,
      service_id: ids.service,
      name_en: 'Colour',
      name_ar: 'صبغة',
      effective_bps: 2500,
    },
  ],
};

function makeEvent(payload: unknown): ClaimedEvent {
  return {
    id: ids.event,
    companyId: ids.company,
    aggregateType: 'discount_approval_decision',
    aggregateId: ids.decision,
    eventType: 'DiscountApprovedByPerformer',
    payload,
    attempt: 1,
  };
}

it('accepts both complete v1 payloads and legacy v1 payloads lacking decision_id and decided_at', async () => {
  const execute = vi.fn().mockResolvedValue(undefined);
  const useCase = { execute } as unknown as RequestDiscountSelfApprovalNotice;

  await onDiscountApprovedByPerformer(
    useCase,
    makeEvent({
      ...basePayload,
      decision_id: ids.decision,
      decided_at: '2026-10-21T10:00:00.000Z',
    }),
  );
  await onDiscountApprovedByPerformer(useCase, makeEvent(basePayload));

  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ companyId: ids.company, sourceEventId: ids.event }),
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ companyId: ids.company, sourceEventId: ids.event }),
  );
});

it('rejects half-populated payloads carrying only one of decision_id or decided_at', async () => {
  const execute = vi.fn().mockResolvedValue(undefined);
  const useCase = { execute } as unknown as RequestDiscountSelfApprovalNotice;

  await expect(
    onDiscountApprovedByPerformer(
      useCase,
      makeEvent({ ...basePayload, decision_id: ids.decision }),
    ),
  ).rejects.toThrow('DISCOUNT_SELF_APPROVAL_EVENT_INVALID');
  expect(execute).not.toHaveBeenCalled();
});
