import { appendOutboxEvent, type Tx } from '@pospay/db';
import { discountApprovalNoticeRequested } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type {
  DiscountApprovalNoticeOutbox,
  DiscountApprovalNoticeRepository,
} from '../ports/discount-approval-notice.port.ts';

/** ما يحتاجه الفحص والحجز: هوية الطلب داخل المستأجر. */
export interface DiscountApprovalMatchInput {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly requestId: string;
  readonly requestedBy: string;
}

/** عدد اقتراحات الطلب وأعلى نسبة مخزنة فيهما؛ الجرس لا يقرأ كتالوج ولا يقبل حدثاً بلا سطور. */
export const discountApprovalMatchesStatement = (request: DiscountApprovalMatchInput) =>
  sql`SELECT count(*)::int AS proposal_count, coalesce(max(effective_bps), 0)::int AS max_effective_bps
  FROM discount_proposals
  WHERE company_id = ${request.companyId} AND business_id = ${request.businessId}
    AND branch_id = ${request.branchId} AND request_id = ${request.requestId}
    AND requested_by = ${request.requestedBy}`;

/** الحجز فائز واحد لكل طلب؛ الصف الثاني يرى التعارض ولا يكتب، فالجرس واحد لكل طلب. */
export function discountApprovalClaimStatement(
  request: DiscountApprovalMatchInput,
  decision: Parameters<DiscountApprovalNoticeRepository['claim']>[1],
) {
  return sql`INSERT INTO discount_approval_notices
      (company_id, id, business_id, request_id, source_event_id, decided_at, recipient_count)
      VALUES (${request.companyId}, ${decision.id}, ${request.businessId}, ${request.requestId},
        ${decision.sourceEventId}, ${decision.decidedAt.toISOString()}::timestamptz, ${decision.recipientCount})
      ON CONFLICT (company_id, request_id) DO NOTHING RETURNING id`;
}

export function discountApprovalRepository(tx: Tx): DiscountApprovalNoticeRepository {
  return {
    matchesRequest: async (request) => {
      const [row] = await tx.execute<ProposalCountRow>(discountApprovalMatchesStatement(request));
      if (row === undefined) return false;
      return (
        Number(row.proposal_count) === request.lineCount &&
        Number(row.max_effective_bps) === request.maxEffectiveBps
      );
    },
    claim: async (request, decision) =>
      (await tx.execute(discountApprovalClaimStatement(request, decision))).length === 1,
  };
}

export function discountApprovalOutbox(tx: Tx): DiscountApprovalNoticeOutbox {
  return {
    append: (id, payload) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'discount_approval_request',
        aggregateId: payload.request_id,
        eventType: 'DiscountApprovalNoticeRequested',
        payload: discountApprovalNoticeRequested.parse(payload),
      }),
  };
}

type ProposalCountRow = Record<string, unknown> & {
  proposal_count: number;
  max_effective_bps: number;
};
