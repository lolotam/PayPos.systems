import type {
  ApproveDiscountProposalsInput,
  DecideDiscountProposalsResponse,
  RejectDiscountProposalsInput,
} from '@pospay/contracts';
import { resolveDiscountApprover, type DiscountApproverMembership } from '../../domain/discount-approver.ts';
import {
  discountApprovedByPerformerEvent,
  discountDecisionAudits,
  discountDecisionResponse,
} from '../../domain/discount-decision-records.ts';
import { DiscountDecisionError } from '../../domain/discount-decision-error.ts';
import {
  planDiscountDecision,
  planDiscountStatus,
  type DiscountDeciderSnapshot,
  type DiscountDecisionPlan,
  type DiscountDecisionProposal,
  type LockedDiscountProposal,
} from '../../domain/discount-decision-plan.ts';
import { SessionError } from '../../domain/session-error.ts';
import type { SessionEmployee } from '../../domain/session-types.ts';
import type { DiscountDecisionTransaction, DiscountDecisionTransactions } from '../../ports/discount-decision.port.ts';
import type { Clock, SessionWriteContext } from '../../ports/service-session-transactions.port.ts';

export { DiscountDecisionError } from '../../domain/discount-decision-error.ts';

type DecisionInput = ApproveDiscountProposalsInput | RejectDiscountProposalsInput;
type DecisionContext = SessionWriteContext & {
  decision: 'APPROVE' | 'REJECT';
  input: DecisionInput;
};
type DecisionLabels = (snapshot: DiscountDeciderSnapshot) => { ar: string; en: string };
interface DecisionFacts {
  locked: readonly LockedDiscountProposal[];
  membership: DiscountApproverMembership;
  now: Date;
}

/** يقرّر اقتراحات الخصم عن بعد بقفل الدفعة وسلطة العضوية وحدّها، ثم يكتب آثارها معاً. */
export class DecideDiscountProposalsUseCase {
  constructor(
    private readonly transactions: DiscountDecisionTransactions,
    private readonly clock: Clock,
    private readonly labels: DecisionLabels,
  ) {}

  async execute(context: DecisionContext): Promise<DecideDiscountProposalsResponse> {
    return this.transactions.run(context, async (tx) => {
      const response = await tx.idempotent(() => this.decide(tx, context));
      if (response.replayed) {
        await tx.access.lock();
        const now = this.clock.now();
        resolveDiscountApprover(await tx.access.read(now), context.input.approver_membership_id);
      }
      return response.body;
    });
  }

  private async decide(
    tx: DiscountDecisionTransaction,
    context: DecisionContext,
  ): Promise<DecideDiscountProposalsResponse> {
    await tx.access.lock();
    const locked = await this.lockProposals(tx, context.input.proposal_ids);
    const employeeIds = proposalEmployeeIds(locked);
    if (context.decision === 'APPROVE') await tx.performers.lock(employeeIds);
    const now = this.clock.now();
    planDiscountStatus(locked, context.input.terms_hashes, now);
    const membership = resolveDiscountApprover(
      await tx.access.read(now),
      context.input.approver_membership_id,
    );
    const plan = await this.plan(tx, context, { locked, membership, now });
    const decider = await this.deciderSnapshot(tx, context.userId, membership);
    if (await tx.proposals.decide(plan, decider) !== locked.length) {
      throw new DiscountDecisionError('DISCOUNT_PROPOSAL_NOT_PENDING', {
        proposal_id: locked[0]?.id,
      });
    }
    await tx.audit(discountDecisionAudits(plan, { decided_via: 'REMOTE', decided_device_id: null }));
    const labels = this.labels(decider);
    const event = discountApprovedByPerformerEvent(plan, locked, {
      business_id: context.businessId,
      branch_id: context.branchId,
      decided_via: 'REMOTE',
      decided_device_id: null,
      decider_label_ar: labels.ar,
      decider_label_en: labels.en,
    });
    if (event !== null) await tx.emit(event);
    return discountDecisionResponse(plan);
  }

  private async lockProposals(
    tx: DiscountDecisionTransaction,
    ids: readonly string[],
  ): Promise<readonly LockedDiscountProposal[]> {
    const rows = await tx.proposals.lock(ids);
    if (rows.length !== ids.length) throw new SessionError('FORBIDDEN');
    const byId = new Map(rows.map((row) => [row.id.toLowerCase(), row]));
    return ids.map((id) => {
      const proposal = byId.get(id.toLowerCase());
      if (proposal === undefined) throw new SessionError('FORBIDDEN');
      return proposal;
    });
  }

  private async plan(
    tx: DiscountDecisionTransaction,
    context: DecisionContext,
    facts: DecisionFacts,
  ): Promise<DiscountDecisionPlan> {
    const { locked, membership, now } = facts;
    const base = {
      user_id: context.userId,
      membership_id: membership.membership_id,
      now,
    };
    if (context.decision === 'REJECT') {
      return planDiscountDecision({
        ...base,
        decision: 'REJECT',
        reason: 'reason' in context.input ? context.input.reason : undefined,
        proposals: decisionProposals(locked, []),
      });
    }
    const limit = await tx.discount.read(membership.membership_id);
    const current = await tx.performers.read(proposalEmployeeIds(locked), now);
    return planDiscountDecision({
      ...base,
      decision: 'APPROVE',
      limit,
      proposals: decisionProposals(locked, current),
    });
  }

  private async deciderSnapshot(
    tx: DiscountDecisionTransaction,
    userId: string,
    membership: DiscountApproverMembership,
  ): Promise<DiscountDeciderSnapshot> {
    const names = await tx.approverName.read(userId);
    return {
      decider_name_ar: names?.name_ar ?? null,
      decider_name_en: names?.name_en ?? null,
      decider_role: membership.role.code,
      decider_role_is_system: membership.role.is_system,
      decider_role_name_ar: membership.role.name_ar,
      decider_role_name_en: membership.role.name_en,
    };
  }
}

function proposalEmployeeIds(locked: readonly LockedDiscountProposal[]): string[] {
  return [...new Set(locked.flatMap((proposal) => proposal.performers.map((performer) => performer.employee_id)))].sort();
}

function decisionProposals(
  locked: readonly LockedDiscountProposal[],
  current: readonly SessionEmployee[],
): DiscountDecisionProposal[] {
  const byId = new Map(current.map((employee) => [employee.id.toLowerCase(), employee]));
  return locked.map((proposal) => ({
    id: proposal.id,
    status: proposal.status,
    expires_at: proposal.expires_at,
    effective_bps: proposal.effective_bps,
    requested_by: proposal.requested_by,
    service_id: proposal.service_id,
    service_name_en: proposal.service_name_en,
    service_name_ar: proposal.service_name_ar,
    occurred_at: proposal.occurred_at,
    performers: proposal.performers.map((performer) => ({
      snapshot_user_id: performer.snapshot_user_id,
      current_user_id: byId.get(performer.employee_id.toLowerCase())?.user_id ?? null,
    })),
  }));
}
