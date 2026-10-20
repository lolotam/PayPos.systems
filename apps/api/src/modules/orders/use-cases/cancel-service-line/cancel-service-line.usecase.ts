import type { CancelServiceLineInput, CancelServiceLineResponse } from '@pospay/contracts';
import { identityLockBatches } from '../../domain/employee-order.ts';
import { lineCancelAudit } from '../../domain/line-cancel-audit.ts';
import { resolveSessionCanceller } from '../../domain/line-cancel-canceller.ts';
import { evaluateLineCancel } from '../../domain/line-cancel-evaluate.ts';
import { lineCancelEvent } from '../../domain/line-cancel-event.ts';
import type { PreparedLineCancel } from '../../domain/line-cancel-prepare.ts';
import { normalizeCancelReason } from '../../domain/line-cancel-reason.ts';
import { projectCancelResponse, savedLineCancelResponse } from '../../domain/line-cancel-response.ts';
import type { LineEditPerformer } from '../../domain/line-edit-identity.ts';
import { lineActorAccess, linePerformerIdentities, refuseStaleLine, selectedLineMembership } from '../../domain/line-mutation-shared.ts';
import { SessionError } from '../../domain/session-error.ts';
import type { SessionEmployee, SessionLine, SessionRecord } from '../../domain/session-types.ts';
import type {
  ActiveLinePerformers,
  LineCancelTransaction,
  LineCancelTransactions,
  ServiceLineCancellationInsert,
} from '../../ports/line-cancel.port.ts';
import type {
  LockedLinePerformer,
  LockedServiceLine,
  SessionEditFacts,
  SessionEditorMembership,
} from '../../ports/line-edit.port.ts';
import type { Clock, IdGenerator, SessionWriteContext } from '../../ports/service-session-transactions.port.ts';

type CancelContext = SessionWriteContext & { sessionId: string; lineId: string; input: CancelServiceLineInput };
interface LockedCancel { line: LockedServiceLine; retained: readonly LockedLinePerformer[] }
interface CancelDecision {
  facts: SessionEditFacts;
  at: Date;
  canceller: SessionEditorMembership;
  reason: string;
  prepared: PreparedLineCancel;
}

/** يلغي بند زيارة واحد ويُسقط الأرقام عمّن لا تقرأ الزيارات. */
export class CancelServiceLineUseCase {
  constructor(
    private readonly transactions: LineCancelTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(context: CancelContext): Promise<CancelServiceLineResponse> {
    return this.transactions.run(context, (tx) => this.run(tx, context));
  }

  private async run(tx: LineCancelTransaction, context: CancelContext): Promise<CancelServiceLineResponse> {
    await this.authorize(tx, context);
    let canRead: boolean | undefined;
    const result = await tx.idempotent(async () => {
      const saved = await this.cancel(tx, context);
      canRead = saved.canRead;
      return saved.body;
    });
    // المعالج لا يشتغل عند إعادة الإرسال، فإعادة فحص الصلاحية تتم هنا داخل المعاملة قبل إرجاع الجسم المخزون.
    if (result.replayed) canRead = await this.recheck(tx, context);
    if (canRead === undefined) throw new Error('Cancel read missing');
    return projectCancelResponse(canRead, result.body.line, result.body.session);
  }

  private async authorize(tx: LineCancelTransaction, context: CancelContext): Promise<void> {
    const access = lineActorAccess(await tx.access.read(this.clock.now()));
    resolveSessionCanceller(access, context.input.canceller_membership_id ?? access.eligible_membership_ids[0]);
  }

  private async recheck(tx: LineCancelTransaction, context: CancelContext): Promise<boolean> {
    await tx.access.lock();
    const facts = await tx.access.read(this.clock.now());
    const access = lineActorAccess(facts);
    resolveSessionCanceller(access, context.input.canceller_membership_id ?? access.eligible_membership_ids[0]);
    if ((await tx.place.read()) === null) throw new SessionError('FORBIDDEN');
    return facts.can_read;
  }

  private async cancel(tx: LineCancelTransaction, context: CancelContext) {
    const locked = await this.loadLocked(tx, context);
    const decision = await this.decide(tx, context, locked);
    const updated = await tx.lines.cancelLine(context.sessionId, context.lineId, context.input.expected_revision);
    if (!updated.changed) return this.refuseStale(tx, context);
    return this.persist(tx, context, locked.line, decision, updated.revision);
  }

  private async loadLocked(tx: LineCancelTransaction, context: CancelContext): Promise<LockedCancel> {
    await tx.access.lock();
    await tx.lines.lockVisit(context.sessionId);
    const line = await tx.lines.loadLineForUpdate(context.sessionId, context.lineId);
    if (line === null) throw new SessionError('FORBIDDEN');
    const retained = await tx.identities.retainedForLine(context.sessionId, context.lineId);
    for (const batch of identityLockBatches(line.performers, retained)) {
      await tx.performers.lock(batch);
    }
    return { line, retained };
  }

  private async decide(tx: LineCancelTransaction, context: CancelContext, locked: LockedCancel): Promise<CancelDecision> {
    const at = this.clock.now();
    const facts = await tx.access.read(at);
    const membershipId = resolveSessionCanceller(lineActorAccess(facts), context.input.canceller_membership_id);
    const canceller = selectedLineMembership(facts, membershipId);
    if ((await tx.place.read()) === null) throw new SessionError('FORBIDDEN');
    const performers = await this.identities(tx, locked);
    const active = await tx.lines.activePerformers(context.sessionId);
    const prepared = evaluateLineCancel(cancelFacts(context, locked.line, at, performers, active, await tx.tips.currentEmployeeIds(context.sessionId)));
    return { facts, at, canceller, reason: normalizeCancelReason(context.input.reason), prepared };
  }

  private async identities(tx: LineCancelTransaction, locked: LockedCancel): Promise<LineEditPerformer[]> {
    const currentIds = locked.line.performers.map((performer) => performer.employee_id);
    const batches = identityLockBatches(locked.line.performers, locked.retained);
    if (batches.length === 0) return [];
    const found: SessionEmployee[] = [];
    for (const batch of batches) {
      found.push(...(await tx.performers.read(batch, locked.line.occurred_at)));
    }
    if (currentIds.some((id) => !found.some((employee) => employee.id === id))) throw new SessionError('FORBIDDEN');
    return [...linePerformerIdentities(locked.line.performers, found), ...linePerformerIdentities(locked.retained, found)];
  }

  private async persist(
    tx: LineCancelTransaction,
    context: CancelContext,
    line: LockedServiceLine,
    decision: CancelDecision,
    revision: number,
  ) {
    const cancellationId = this.ids.newId();
    const names = await tx.editors.read(context.userId);
    await tx.lines.insertCancellation(context.sessionId, context.lineId, cancellationInsert(cancellationId, line, decision, revision, names, context.userId));
    const record = await tx.lines.loadSession(context.sessionId);
    if (record === null) throw new SessionError('FORBIDDEN');
    const saved = record.lines.find((item) => item.id === context.lineId);
    if (saved === undefined) throw new SessionError('FORBIDDEN');
    const body = savedLineCancelResponse(record, context.lineId, decision.at);
    await tx.audit(this.ids.newId(), lineCancelAudit(auditInput(context, line, decision, cancellationId)));
    await tx.emit(this.ids.newId(), context.sessionId, lineCancelEvent(eventInput(context, record, saved, decision)));
    return { canRead: decision.facts.can_read, body };
  }

  private async refuseStale(tx: LineCancelTransaction, context: CancelContext): Promise<never> {
    return refuseStaleLine(() => tx.lines.loadLineForUpdate(context.sessionId, context.lineId));
  }
}

function cancelFacts(
  context: CancelContext,
  line: LockedServiceLine,
  at: Date,
  performers: readonly LineEditPerformer[],
  active: ActiveLinePerformers,
  tipEmployeeIds: readonly string[],
) {
  return {
    actor_user_id: context.userId,
    performers,
    preparation: {
      line: { status: line.status, revision: line.revision, price: line.price, discount: line.discount, net: line.net, not_cancellable: false },
      expected_revision: context.input.expected_revision,
      business_date: line.business_date,
      now: at,
      business_timezone: line.business_timezone,
      reason: context.input.reason,
      line_id: context.lineId,
      active_lines: active.lines,
      performers_by_line: active.performers_by_line,
      current_tip_employee_ids: tipEmployeeIds,
    },
  };
}

function cancellationInsert(
  id: string,
  line: LockedServiceLine,
  decision: CancelDecision,
  revision: number,
  names: { name_ar: string | null; name_en: string } | null,
  userId: string,
): ServiceLineCancellationInsert {
  return {
    id,
    previous_revision: line.revision,
    revision,
    previous_price: line.price,
    previous_discount: line.discount,
    previous_net: line.net,
    reason: decision.reason,
    cancelled_at: decision.at,
    cancelled_by: userId,
    cancelled_by_membership_id: decision.canceller.membership_id,
    canceller_name_ar: names?.name_ar ?? null,
    canceller_name_en: names?.name_en ?? null,
    canceller_role: decision.canceller.role.code,
    canceller_role_is_system: decision.canceller.role.is_system,
    canceller_role_name_ar: decision.canceller.role.name_ar,
    canceller_role_name_en: decision.canceller.role.name_en,
  };
}

function auditInput(context: CancelContext, line: LockedServiceLine, decision: CancelDecision, cancellationId: string) {
  return {
    sessionId: context.sessionId,
    lineId: context.lineId,
    cancellationId,
    revisionBefore: line.revision,
    cancellerUserId: context.userId,
    cancellerMembershipId: decision.canceller.membership_id,
    cancelledAt: decision.at,
    figures: { price: line.price, discount: line.discount, net: line.net },
  };
}

function eventInput(context: CancelContext, record: SessionRecord, saved: SessionLine, decision: CancelDecision) {
  return {
    record,
    line: saved,
    previous: decision.prepared.previous,
    canceller: { userId: context.userId, membershipId: decision.canceller.membership_id, at: decision.at },
  };
}
