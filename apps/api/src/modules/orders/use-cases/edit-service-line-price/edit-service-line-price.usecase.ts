import type { EditServiceLineInput, EditServiceLineResponse } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { identityLockBatches } from '../../domain/employee-order.ts';
import { lineEditAudit } from '../../domain/line-edit-audit.ts';
import { resolveSessionEditor } from '../../domain/line-edit-editor.ts';
import { lineEditEvent } from '../../domain/line-edit-event.ts';
import { assertEditorIsNotPerformer } from '../../domain/line-edit-identity.ts';
import { assertLineEditable, prepareLineEdit, type PreparedLineEdit } from '../../domain/line-edit-prepare.ts';
import { normalizeEditReason } from '../../domain/line-edit-reason.ts';
import { projectEditResponse, savedLineEditResponse } from '../../domain/line-edit-response.ts';
import { lineActorAccess, linePerformerIdentities, refuseStaleLine, selectedLineMembership } from '../../domain/line-mutation-shared.ts';
import { SessionError } from '../../domain/session-error.ts';
import { validateAppendWindow } from '../../domain/session-time.ts';
import type { SessionEmployee, SessionLine, SessionRecord } from '../../domain/session-types.ts';
import type {
  LineEditTransaction,
  LineEditTransactions,
  LockedLinePerformer,
  LockedServiceLine,
  ServiceLineEditInsert,
  SessionEditFacts,
  SessionEditorMembership,
} from '../../ports/line-edit.port.ts';
import type { Clock, IdGenerator, SessionWriteContext } from '../../ports/service-session-transactions.port.ts';

type EditContext = SessionWriteContext & { sessionId: string; lineId: string; input: EditServiceLineInput };
interface LockedEdit { line: LockedServiceLine; retained: readonly LockedLinePerformer[] }
interface EditDecision {
  facts: SessionEditFacts;
  at: Date;
  editor: SessionEditorMembership;
  reason: string;
  prepared: PreparedLineEdit;
}

/** يعدّل سعر بند الزيارة أو خصمه ويُسقط الأرقام عمّن لا تقرأ الزيارات. */
export class EditServiceLinePriceUseCase {
  constructor(
    private readonly transactions: LineEditTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(context: EditContext): Promise<EditServiceLineResponse> {
    return this.transactions.run(context, (tx) => this.run(tx, context));
  }

  private async run(tx: LineEditTransaction, context: EditContext): Promise<EditServiceLineResponse> {
    await this.authorize(tx, context);
    let held: SessionEditFacts | undefined;
    const result = await tx.idempotent(async () => {
      const edited = await this.edit(tx, context);
      held = edited.facts;
      return edited.body;
    });
    if (result.replayed) return projectEditResponse(result.body, await this.recheck(tx, context));
    if (held === undefined) throw new Error('Edit facts missing');
    return projectEditResponse(result.body, held.can_read);
  }

  private async authorize(tx: LineEditTransaction, context: EditContext): Promise<void> {
    if ((await tx.place.read()) === null) throw new SessionError('FORBIDDEN');
    const access = lineActorAccess(await tx.access.read(this.clock.now()));
    resolveSessionEditor(access, context.input.editor_membership_id ?? access.eligible_membership_ids[0]);
  }

  private async recheck(tx: LineEditTransaction, context: EditContext): Promise<boolean> {
    const facts = await tx.access.read(this.clock.now());
    const access = lineActorAccess(facts);
    resolveSessionEditor(access, context.input.editor_membership_id ?? access.eligible_membership_ids[0]);
    return facts.can_read;
  }

  private async edit(tx: LineEditTransaction, context: EditContext) {
    const locked = await this.loadLocked(tx, context);
    const decision = await this.decide(tx, context, locked);
    return { facts: decision.facts, body: await this.commit(tx, context, locked.line, decision) };
  }

  private async loadLocked(tx: LineEditTransaction, context: EditContext): Promise<LockedEdit> {
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

  private async decide(tx: LineEditTransaction, context: EditContext, locked: LockedEdit): Promise<EditDecision> {
    const at = this.clock.now();
    const facts = await tx.access.read(at);
    const membershipId = resolveSessionEditor(lineActorAccess(facts), context.input.editor_membership_id);
    const editor = selectedLineMembership(facts, membershipId);
    // الحد يُقرأ من جديد بعد كل انتظار؛ قفل العضويات FOR SHARE لا يسمح باختبار تغيّره أثناء الانتظار.
    const limit = await tx.discount.read(membershipId);
    if ((await tx.place.read()) === null) throw new SessionError('FORBIDDEN');
    await this.refusePerformer(tx, context, locked);
    assertLineEditable(locked.line, context.input.expected_revision);
    validateAppendWindow(locked.line.business_date, at, locked.line.business_timezone);
    const reason = normalizeEditReason(context.input.reason);
    const prepared = prepareLineEdit({
      list_price: locked.line.list_price,
      current: { price: locked.line.price, discount: locked.line.discount },
      requested: { price: parseMoney(context.input.price), discount: requestedDiscount(context.input) },
      limit,
      other_active_nets: await tx.lines.activeNets(context.sessionId, context.lineId),
    });
    return { facts, at, editor, reason, prepared };
  }

  private async refusePerformer(tx: LineEditTransaction, context: EditContext, locked: LockedEdit): Promise<void> {
    const line = locked.line;
    const employeeIds = line.performers.map((performer) => performer.employee_id);
    if (employeeIds.length === 0) {
      assertEditorIsNotPerformer(context.userId, []);
      return;
    }
    const found = await this.readIdentities(tx, locked);
    if (missingPerformer(employeeIds, found)) throw new SessionError('FORBIDDEN');
    assertEditorIsNotPerformer(context.userId, [
      ...linePerformerIdentities(line.performers, found),
      ...linePerformerIdentities(locked.retained, found),
    ]);
  }

  private async readIdentities(tx: LineEditTransaction, locked: LockedEdit): Promise<SessionEmployee[]> {
    const found: SessionEmployee[] = [];
    for (const batch of identityLockBatches(locked.line.performers, locked.retained)) {
      found.push(...(await tx.performers.read(batch, locked.line.occurred_at)));
    }
    return found;
  }

  private async commit(tx: LineEditTransaction, context: EditContext, line: LockedServiceLine, decision: EditDecision) {
    const updated = await tx.lines.updateLine(context.sessionId, context.lineId, {
      price: decision.prepared.price,
      discount: decision.prepared.discount,
      net: decision.prepared.net,
      effective_discount_bps: decision.prepared.effective_discount_bps,
      limit_bps_applied: decision.prepared.limit.bps,
      limit_source: decision.prepared.limit.source,
      expected_revision: context.input.expected_revision,
    });
    if (!updated.changed) return this.refuseStale(tx, context);
    const record = await this.persist(tx, context, line, decision, updated.revision);
    return savedLineEditResponse(record, context.lineId);
  }

  private async persist(
    tx: LineEditTransaction,
    context: EditContext,
    line: LockedServiceLine,
    decision: EditDecision,
    revision: number,
  ): Promise<SessionRecord> {
    const names = await tx.editors.read(context.userId);
    const editId = this.ids.newId();
    await tx.lines.insertEdit(context.sessionId, context.lineId, editInsert(editId, line, decision, revision, names, context.userId));
    const record = await tx.lines.loadSession(context.sessionId);
    if (record === null) throw new SessionError('FORBIDDEN');
    const saved = record.lines.find((item) => item.id === context.lineId);
    if (saved === undefined) throw new SessionError('FORBIDDEN');
    await tx.audit(this.ids.newId(), lineEditAudit(auditInput(context, line, saved, decision, editId)));
    await tx.emit(this.ids.newId(), context.sessionId, lineEditEvent(eventInput(context, record, saved, line, decision)));
    return record;
  }

  private async refuseStale(tx: LineEditTransaction, context: EditContext): Promise<never> {
    return refuseStaleLine(() => tx.lines.loadLineForUpdate(context.sessionId, context.lineId));
  }
}

function requestedDiscount(input: EditServiceLineInput) {
  if (input.discount.kind === 'PERCENT') return { kind: 'PERCENT' as const, bps: input.discount.bps };
  return { kind: 'AMOUNT' as const, amount: parseMoney(input.discount.amount) };
}

function missingPerformer(employeeIds: readonly string[], current: readonly SessionEmployee[]): boolean {
  return employeeIds.some((id) => !current.some((employee) => employee.id === id));
}

function editInsert(
  id: string,
  line: LockedServiceLine,
  decision: EditDecision,
  revision: number,
  names: { name_ar: string | null; name_en: string } | null,
  userId: string,
): ServiceLineEditInsert {
  return {
    id,
    previous_revision: line.revision,
    revision,
    previous_price: line.price,
    previous_discount: line.discount,
    previous_net: line.net,
    new_price: decision.prepared.price,
    new_discount: decision.prepared.discount,
    new_net: decision.prepared.net,
    previous_effective_discount_bps: line.effective_discount_bps,
    previous_limit_bps_applied: line.limit_bps_applied,
    previous_limit_source: line.limit_source,
    new_effective_discount_bps: decision.prepared.effective_discount_bps,
    new_limit_bps_applied: decision.prepared.limit.bps,
    new_limit_source: decision.prepared.limit.source,
    reason: decision.reason,
    changed_at: decision.at,
    changed_by: userId,
    changed_by_membership_id: decision.editor.membership_id,
    editor_name_ar: names?.name_ar ?? null,
    editor_name_en: names?.name_en ?? null,
    editor_role: decision.editor.role.code,
    editor_role_is_system: decision.editor.role.is_system,
    editor_role_name_ar: decision.editor.role.name_ar,
    editor_role_name_en: decision.editor.role.name_en,
  };
}

function auditInput(context: EditContext, line: LockedServiceLine, saved: SessionLine, decision: EditDecision, editId: string) {
  return {
    sessionId: context.sessionId,
    lineId: context.lineId,
    editId,
    revisionBefore: line.revision,
    editorUserId: context.userId,
    editorMembershipId: decision.editor.membership_id,
    changedAt: decision.at,
    previous: { price: line.price, discount: line.discount, net: line.net },
    next: {
      price: saved.price,
      discount: saved.discount,
      net: saved.net,
      effective_discount_bps: saved.effective_discount_bps,
      limit_bps_applied: saved.limit.bps,
      limit_source: saved.limit.source,
    },
  };
}

function eventInput(context: EditContext, record: SessionRecord, saved: SessionLine, line: LockedServiceLine, decision: EditDecision) {
  return {
    record,
    line: saved,
    previous: { revision: line.revision, price: line.price, discount: line.discount, net: line.net },
    editor: { userId: context.userId, membershipId: decision.editor.membership_id, at: decision.at },
  };
}
