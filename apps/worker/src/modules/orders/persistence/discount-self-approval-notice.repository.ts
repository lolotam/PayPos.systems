import { appendOutboxEvent, type Tx } from '@pospay/db';
import { discountSelfApprovalNoticeRequested } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type {
  DiscountSelfApprovalNoticeEvent,
  DiscountSelfApprovalNoticeOutbox,
  DiscountSelfApprovalNoticeRepository,
} from '../ports/discount-self-approval-notice.port.ts';

/** فحص المصدر استعلام واحد على المفتاح الرئيسي (company_id,id): النشاط والفرع والحالة والعلم في SQL،
 * وتطابق service_id والنسبة والموافِق وطريقته في TypeScript، فعدد الصفوف exact هو دليل اكتمال العدد. */
export function discountSelfApprovalMatchesStatement(event: DiscountSelfApprovalNoticeEvent) {
  const ids = sql.join(
    event.proposals.map((proposal) => sql`${proposal.id}`),
    sql`, `,
  );
  return sql`SELECT id, service_id, effective_bps, decided_by, decided_via
    FROM discount_proposals
    WHERE company_id = ${event.companyId} AND business_id = ${event.businessId}
      AND branch_id = ${event.branchId} AND id IN (${ids})
      AND approver_is_performer IS TRUE
      AND status IN ('APPROVED','CONSUMED')`;
}

/** الحجز فائز واحد لكل حدث مصدر؛ الصف الثاني يرى التعارض ولا يكتب، فالجرس واحد لكل حدث. */
export function discountSelfApprovalClaimStatement(
  event: DiscountSelfApprovalNoticeEvent,
  decision: Parameters<DiscountSelfApprovalNoticeRepository['claim']>[1],
) {
  return sql`INSERT INTO discount_self_approval_notices
      (company_id, id, business_id, source_event_id, decided_at, recipient_count)
      VALUES (${event.companyId}, ${decision.id}, ${event.businessId}, ${decision.sourceEventId},
        ${decision.decidedAt.toISOString()}::timestamptz, ${decision.recipientCount})
      ON CONFLICT (company_id, source_event_id) DO NOTHING RETURNING id`;
}

export function discountSelfApprovalRepository(tx: Tx): DiscountSelfApprovalNoticeRepository {
  return {
    matchesProposals: async (event) => {
      const rows = await tx.execute<StoredProposalRow>(discountSelfApprovalMatchesStatement(event));
      if (rows.length !== event.proposals.length) return false;
      const wanted = new Map(event.proposals.map((proposal) => [proposal.id, proposal]));
      return rows.every((row) => {
        const proposal = wanted.get(row.id);
        return (
          proposal !== undefined &&
          row.service_id === proposal.serviceId &&
          Number(row.effective_bps) === proposal.effectiveBps &&
          row.decided_by === event.decidedBy &&
          row.decided_via === event.decidedVia
        );
      });
    },
    claim: async (event, decision) =>
      (await tx.execute(discountSelfApprovalClaimStatement(event, decision))).length === 1,
  };
}

export function discountSelfApprovalOutbox(tx: Tx): DiscountSelfApprovalNoticeOutbox {
  return {
    append: (id, aggregateId, payload) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'discount_self_approval',
        aggregateId,
        eventType: 'DiscountSelfApprovalNoticeRequested',
        payload: discountSelfApprovalNoticeRequested.parse(payload),
      }),
  };
}

type StoredProposalRow = Record<string, unknown> & {
  id: string;
  service_id: string;
  effective_bps: number;
  decided_by: string;
  decided_via: string;
};
