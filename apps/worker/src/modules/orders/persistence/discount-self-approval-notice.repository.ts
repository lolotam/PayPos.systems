import { appendOutboxEvent, type Tx } from '@pospay/db';
import { discountSelfApprovalNoticeRequested } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type {
  DiscountSelfApprovalNoticeEvent,
  DiscountSelfApprovalNoticeOutbox,
  DiscountSelfApprovalNoticeRepository,
} from '../ports/discount-self-approval-notice.port.ts';

export const discountSelfApprovalMatchesStatement = (
  event: DiscountSelfApprovalNoticeEvent,
) => sql`SELECT count(*)::int AS proposal_count
  FROM discount_proposals p
  JOIN (
    VALUES ${sql.join(
      event.proposals.map(
        (proposal) =>
          sql`(${proposal.id}::uuid, ${proposal.serviceId}::uuid, ${proposal.effectiveBps}::int)`,
      ),
      sql`, `,
    )}
  ) AS expected(id, service_id, effective_bps) ON p.id = expected.id
  WHERE p.company_id = ${event.companyId} AND p.business_id = ${event.businessId}
    AND p.branch_id = ${event.branchId} AND p.service_id = expected.service_id
    AND p.effective_bps = expected.effective_bps AND p.decided_by = ${event.decidedBy}
    AND p.decided_via = ${event.decidedVia} AND p.approver_is_performer IS TRUE
    AND p.status IN ('APPROVED', 'CONSUMED')`;

export function discountSelfApprovalClaimStatement(
  event: DiscountSelfApprovalNoticeEvent,
  decision: Parameters<DiscountSelfApprovalNoticeRepository['claim']>[1],
) {
  return sql`INSERT INTO discount_self_approval_notices
      (company_id, id, business_id, source_event_id, decided_at, recipient_count)
      VALUES (${event.companyId}, ${decision.id}, ${event.businessId},
        ${decision.sourceEventId}, ${decision.decidedAt.toISOString()}::timestamptz, ${decision.recipientCount})
      ON CONFLICT (company_id, source_event_id) DO NOTHING RETURNING id`;
}

export function discountSelfApprovalRepository(tx: Tx): DiscountSelfApprovalNoticeRepository {
  return {
    matchesProposals: async (event) => {
      const [row] = await tx.execute<ProposalCountRow>(discountSelfApprovalMatchesStatement(event));
      return row !== undefined && Number(row.proposal_count) === event.proposals.length;
    },
    claim: async (event, decision) =>
      (await tx.execute(discountSelfApprovalClaimStatement(event, decision))).length === 1,
  };
}

export function discountSelfApprovalOutbox(tx: Tx): DiscountSelfApprovalNoticeOutbox {
  return {
    append: (id, aggregateId, payload) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'discount_self_approval_notice',
        aggregateId,
        eventType: 'DiscountSelfApprovalNoticeRequested',
        payload: discountSelfApprovalNoticeRequested.parse(payload),
      }),
  };
}

type ProposalCountRow = Record<string, unknown> & { proposal_count: number };
