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
  type DiscountDecisionChannel,
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
import type { SessionEmployee, SessionLimit } from '../../domain/session-types.ts';
import type {
  DiscountDecisionTransaction,
  DiscountDecisionTransactions,
  DiscountProposalPerformerIds,
} from '../../ports/discount-decision.port.ts';
import type { Clock, SessionWriteContext } from '../../ports/service-session-transactions.port.ts';

export { DiscountDecisionError } from '../../domain/discount-decision-error.ts';

type DecisionInput = ApproveDiscountProposalsInput | RejectDiscountProposalsInput;
type DecisionContext = SessionWriteContext & {
  decision: 'APPROVE' | 'REJECT';
  input: DecisionInput;
  /** قناة القرار؛ غيابها يعني القرار البعيد بلا جهاز. */
  channel?: { via: 'PIN'; deviceId: string; pinRevision: string; confirmBinding: () => Promise<boolean> };
};
type DecisionLabels = (snapshot: DiscountDeciderSnapshot) => { ar: string; en: string };
interface DecisionFacts {
  locked: readonly LockedDiscountProposal[];
  membership: DiscountApproverMembership;
  now: Date;
}

interface ApprovalFacts {
  limit: SessionLimit;
  current: readonly SessionEmployee[];
}

/** يقرّر اقتراحات الخصم عن بعد بقفل الدفعة وسلطة العضوية وحدّها، ثم يكتب آثارها معاً. */
export class DecideDiscountProposalsUseCase {
  constructor(
    private readonly transactions: DiscountDecisionTransactions,
    private readonly clock: Clock,
    private readonly labels: DecisionLabels,
  ) {}

  async execute(context: DecisionContext): Promise<DecideDiscountProposalsResponse> {
    const channel = context.channel;
    if (channel !== undefined) {
      return this.transactions.run(context, async (tx) => {
        const fenced = await tx.fence.lock({
          deviceId: channel.deviceId,
          approverUserId: context.userId,
          pinRevision: channel.pinRevision,
          confirmBinding: channel.confirmBinding,
        });
        if (!fenced) throw new SessionError('FORBIDDEN');
        return this.decide(tx, context);
      });
    }
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
    const channel = this.channel(context);
    await tx.access.lock();
    const peeked = context.decision === 'APPROVE'
      ? await this.peekProposals(tx, context.input.proposal_ids)
      : [];
    if (context.decision === 'APPROVE') await tx.performers.lock(peekedEmployeeIds(peeked));
    const locked = await this.lockProposals(tx, context.input.proposal_ids);
    if (context.decision === 'APPROVE' && !sameProposalPerformers(peeked, locked)) {
      throw new SessionError('FORBIDDEN');
    }
    const now = this.clock.now();
    planDiscountStatus(locked, context.input.terms_hashes, now);
    const membership = resolveDiscountApprover(
      await tx.access.read(now),
      context.input.approver_membership_id,
    );
    const approval = context.decision === 'APPROVE'
      ? await this.approvalFacts(tx, locked, membership, now)
      : null;
    const decider = await this.deciderSnapshot(tx, context.userId, membership);
    // قراءات الإعدادات والعضوية قد تنتظر خلف كاتب، لذلك فحص الانتهاء وشرط UPDATE يحتاجان اللحظة التالية لآخر قفل.
    const decidedAt = this.clock.now();
    planDiscountStatus(locked, context.input.terms_hashes, decidedAt);
    if (context.decision === 'APPROVE') {
      await this.recheckApprover(tx, context, membership, decidedAt);
    }
    const plan = this.plan(context, { locked, membership, now: decidedAt }, approval);
    if (await tx.proposals.decide(plan, decider, channel) !== locked.length) {
      throw new DiscountDecisionError('DISCOUNT_PROPOSAL_NOT_PENDING', {
        proposal_id: locked[0]?.id,
      });
    }
    await tx.audit(discountDecisionAudits(plan, channel));
    const labels = this.labels(decider);
    const event = discountApprovedByPerformerEvent(plan, locked, {
      ...channel,
      business_id: context.businessId,
      branch_id: context.branchId,
      decider_label_ar: labels.ar,
      decider_label_en: labels.en,
    });
    if (event !== null) await tx.emit(event);
    return discountDecisionResponse(plan);
  }

  private channel(context: DecisionContext): DiscountDecisionChannel {
    const channel = context.channel;
    if (channel === undefined) return { decided_via: 'REMOTE', decided_device_id: null };
    return { decided_via: channel.via, decided_device_id: channel.deviceId };
  }

  private async recheckApprover(
    tx: DiscountDecisionTransaction,
    context: DecisionContext,
    membership: DiscountApproverMembership,
    decidedAt: Date,
  ): Promise<void> {
    try {
      // قراءة الحد قد تنتظر خلف كاتب، لذلك انتهاء العضوية أو السماح أثناء الانتظار لا يجوز أن يمرّر الموافقة.
      const recheck = resolveDiscountApprover(
        await tx.access.read(decidedAt),
        context.input.approver_membership_id,
      );
      if (recheck.membership_id !== membership.membership_id) throw new SessionError('FORBIDDEN');
    } catch (error) {
      if (error instanceof DiscountDecisionError && error.code === 'DISCOUNT_APPROVER_MEMBERSHIP_REQUIRED') {
        throw new SessionError('FORBIDDEN');
      }
      throw error;
    }
  }

  private async peekProposals(
    tx: DiscountDecisionTransaction,
    ids: readonly string[],
  ): Promise<readonly DiscountProposalPerformerIds[]> {
    const rows = await tx.proposals.peek(ids);
    if (rows.length < ids.length) throw new SessionError('FORBIDDEN');
    return rows;
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

  private async approvalFacts(
    tx: DiscountDecisionTransaction,
    locked: readonly LockedDiscountProposal[],
    membership: DiscountApproverMembership,
    now: Date,
  ): Promise<ApprovalFacts> {
    const limit = await tx.discount.read(membership.membership_id);
    const current = await tx.performers.read(proposalEmployeeIds(locked), now);
    return { limit, current };
  }

  private plan(
    context: DecisionContext,
    facts: DecisionFacts,
    approval: ApprovalFacts | null,
  ): DiscountDecisionPlan {
    const { locked, membership, now } = facts;
    const base = {
      user_id: context.userId,
      membership_id: membership.membership_id,
      now,
    };
    if (approval === null) {
      return planDiscountDecision({
        ...base,
        decision: 'REJECT',
        reason: 'reason' in context.input ? context.input.reason : undefined,
        proposals: decisionProposals(locked, []),
      });
    }
    return planDiscountDecision({
      ...base,
      decision: 'APPROVE',
      limit: approval.limit,
      proposals: decisionProposals(locked, approval.current),
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

function peekedEmployeeIds(peeked: readonly DiscountProposalPerformerIds[]): string[] {
  return sortedUniqueIds(peeked.flatMap((proposal) => proposal.employee_ids));
}

function sameProposalPerformers(
  peeked: readonly DiscountProposalPerformerIds[],
  locked: readonly LockedDiscountProposal[],
): boolean {
  if (peeked.length !== locked.length) return false;
  const byId = new Map(peeked.map((proposal) => [
    proposal.id.toLowerCase(),
    sortedUniqueIds(proposal.employee_ids),
  ]));
  return locked.every((proposal) => {
    const employeeIds = byId.get(proposal.id.toLowerCase());
    if (employeeIds === undefined) return false;
    const lockedEmployeeIds = sortedUniqueIds(proposal.performers.map((performer) => performer.employee_id));
    return employeeIds.length === lockedEmployeeIds.length
      && employeeIds.every((id, index) => id === lockedEmployeeIds[index]);
  });
}

function sortedUniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.toLowerCase()))].sort();
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
