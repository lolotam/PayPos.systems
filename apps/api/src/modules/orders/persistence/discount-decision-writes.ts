import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type {
  DiscountDeciderSnapshot,
  DiscountDecisionPlan,
  DiscountProposalDecision,
  LockedDiscountProposal,
} from '../domain/discount-decision-plan.ts';
import type { DiscountDecisionChannel } from '../domain/discount-decision-records.ts';
import type { DiscountProposalPerformerIds } from '../ports/discount-decision.port.ts';

export interface DiscountDecisionScope {
  companyId: string;
  businessId: string;
  branchId: string;
}

type LockedRow = {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONSUMED';
  expires_at: Date;
  terms_hash: string;
  effective_bps: number;
  requested_by: string;
  service_id: string;
  service_name_en: string;
  service_name_ar: string | null;
  occurred_at: Date;
};

type PerformerRow = {
  proposal_id: string;
  employee_id: string;
  linked_user_id: string | null;
};

interface DecisionWrite {
  plan: DiscountDecisionPlan;
  decider: DiscountDeciderSnapshot;
  proposal: DiscountProposalDecision;
  channel: DiscountDecisionChannel;
}

export async function peekDiscountDecisions(
  tx: Tx,
  scope: DiscountDecisionScope,
  proposalIds: readonly string[],
): Promise<readonly DiscountProposalPerformerIds[]> {
  const ids = [...new Set(proposalIds.map((id) => id.toLowerCase()))].sort();
  if (ids.length === 0) return [];
  const selected = sql`id=ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`,`)}]::uuid[])`;
  const rows = await tx.execute<Pick<LockedRow, 'id'>>(sql`SELECT id FROM discount_proposals
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND branch_id=${scope.branchId} AND ${selected}
    ORDER BY id`);
  const performers = await tx.execute<Pick<PerformerRow, 'proposal_id' | 'employee_id'>>(
    sql`SELECT proposal_id,employee_id FROM discount_proposal_performers
      WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
        AND proposal_id=ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`,`)}]::uuid[])
      ORDER BY proposal_id,employee_id`,
  );
  return rows.map((row) => ({
    id: row.id,
    employee_ids: [...new Set(performers
      .filter((performer) => performer.proposal_id === row.id)
      .map((performer) => performer.employee_id.toLowerCase()))].sort(),
  }));
}

export async function lockDiscountDecisions(
  tx: Tx,
  scope: DiscountDecisionScope,
  proposalIds: readonly string[],
): Promise<readonly LockedDiscountProposal[]> {
  const ids = [...new Set(proposalIds.map((id) => id.toLowerCase()))].sort();
  if (ids.length === 0) return [];
  const selected = sql`id=ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`,`)}]::uuid[])`;
  const rows = await tx.execute<LockedRow>(sql`SELECT id,status,expires_at,terms_hash,effective_bps,requested_by,
    service_id,service_name_en,service_name_ar,occurred_at FROM discount_proposals
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND branch_id=${scope.branchId} AND ${selected}
    ORDER BY id FOR UPDATE`);
  const performers = await tx.execute<PerformerRow>(sql`SELECT proposal_id,employee_id,linked_user_id
    FROM discount_proposal_performers WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND proposal_id=ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`,`)}]::uuid[])
    ORDER BY proposal_id,employee_id`);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    expires_at: new Date(row.expires_at),
    terms_hash: row.terms_hash.trim(),
    effective_bps: row.effective_bps,
    requested_by: row.requested_by,
    service_id: row.service_id,
    service_name_en: row.service_name_en,
    service_name_ar: row.service_name_ar,
    occurred_at: new Date(row.occurred_at),
    performers: performers.filter((performer) => performer.proposal_id === row.id).map((performer) => ({
      employee_id: performer.employee_id,
      snapshot_user_id: performer.linked_user_id,
    })),
  }));
}

export async function decideDiscountProposals(
  tx: Tx,
  scope: DiscountDecisionScope,
  plan: DiscountDecisionPlan,
  decider: DiscountDeciderSnapshot,
  channel: DiscountDecisionChannel,
): Promise<number> {
  let updated = 0;
  for (const proposal of plan.proposals) {
    const write = { plan, decider, proposal, channel };
    const rows = proposal.status === 'APPROVED'
      ? await approve(tx, scope, write)
      : await reject(tx, scope, write);
    updated += rows.length;
  }
  return updated;
}

async function approve(tx: Tx, scope: DiscountDecisionScope, write: DecisionWrite) {
  const { plan, decider, proposal, channel } = write;
  const decidedAt = plan.decided_at.toISOString();
  return tx.execute<{ id: string }>(sql`UPDATE discount_proposals SET status='APPROVED',
    decided_by=${plan.decided_by},decided_by_membership_id=${plan.decided_by_membership_id},
    decided_via=${channel.decided_via},decided_device_id=${channel.decided_device_id},
    decider_name_ar=${decider.decider_name_ar},decider_name_en=${decider.decider_name_en},
    decider_role=${decider.decider_role},decider_role_is_system=${decider.decider_role_is_system},
    decider_role_name_ar=${decider.decider_role_name_ar},decider_role_name_en=${decider.decider_role_name_en},
    decided_at=${decidedAt}::timestamptz,approved_limit_source=${proposal.approved_limit_source},
    approved_limit_bps=${proposal.approved_limit_bps},approver_is_performer=${proposal.approver_is_performer}
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND branch_id=${scope.branchId} AND id=${proposal.id}
      AND status='PENDING' AND expires_at > ${decidedAt}::timestamptz RETURNING id`);
}

async function reject(tx: Tx, scope: DiscountDecisionScope, write: DecisionWrite) {
  const { plan, decider, proposal, channel } = write;
  const decidedAt = plan.decided_at.toISOString();
  return tx.execute<{ id: string }>(sql`UPDATE discount_proposals SET status='REJECTED',
    decided_by=${plan.decided_by},decided_by_membership_id=${plan.decided_by_membership_id},
    decided_via=${channel.decided_via},decided_device_id=${channel.decided_device_id},
    decider_name_ar=${decider.decider_name_ar},decider_name_en=${decider.decider_name_en},
    decider_role=${decider.decider_role},decider_role_is_system=${decider.decider_role_is_system},
    decider_role_name_ar=${decider.decider_role_name_ar},decider_role_name_en=${decider.decider_role_name_en},
    decided_at=${decidedAt}::timestamptz,approved_limit_source=NULL,approved_limit_bps=NULL,
    approver_is_performer=NULL,reject_reason=${proposal.reject_reason}
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND branch_id=${scope.branchId} AND id=${proposal.id}
      AND status='PENDING' AND expires_at > ${decidedAt}::timestamptz RETURNING id`);
}
