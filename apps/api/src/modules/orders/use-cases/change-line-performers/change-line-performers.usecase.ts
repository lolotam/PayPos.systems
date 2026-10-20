import type { ChangeLinePerformersInput, ChangeLinePerformersResponse } from '@pospay/contracts';
import { identityLockBatches } from '../../domain/employee-order.ts';
import { linePerformersAudit } from '../../domain/line-performers-audit.ts';
import { resolveSessionChanger } from '../../domain/line-performers-changer.ts';
import { evaluateLinePerformersChange } from '../../domain/line-performers-evaluate.ts';
import { linePerformersEvent } from '../../domain/line-performers-event.ts';
import type { LinePerformerRow } from '../../domain/line-performers-plan.ts';
import type { PreparedLinePerformersChange } from '../../domain/line-performers-prepare.ts';
import {
  performersChangedMark,
  projectPerformersChangeResponse,
  savedLinePerformersChangeResponse,
} from '../../domain/line-performers-response.ts';
import { lineActorAccess, linePerformerIdentities, selectedLineMembership } from '../../domain/line-mutation-shared.ts';
import { SessionError } from '../../domain/session-error.ts';
import type { SessionEmployee, SessionLine, SessionRecord } from '../../domain/session-types.ts';
import type { LockedLinePerformer, LockedServiceLine, SessionEditFacts, SessionEditorMembership } from '../../ports/line-edit.port.ts';
import type {
  LinePerformersTransaction,
  LinePerformersTransactions,
  ServiceLinePerformerChangeInsert,
  StoredPerformerRow,
} from '../../ports/line-performers.port.ts';
import type { Clock, IdGenerator, SessionWriteContext } from '../../ports/service-session-transactions.port.ts';

type PerformersContext = SessionWriteContext & { sessionId: string; lineId: string; input: ChangeLinePerformersInput };

interface LockedPerformers {
  line: LockedServiceLine;
  rows: LinePerformerRow[];
  retained: readonly LockedLinePerformer[];
  batches: string[][];
}

interface PerformersDecision {
  facts: SessionEditFacts;
  at: Date;
  changer: SessionEditorMembership;
  prepared: PreparedLinePerformersChange;
}

/** يغيّر منفّذات سطر محفوظ ونسبهن ويُسقط الأرقام عمّن لا يقرأ الزيارات. */
export class ChangeLinePerformersUseCase {
  constructor(
    private readonly transactions: LinePerformersTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(context: PerformersContext): Promise<ChangeLinePerformersResponse> {
    return this.transactions.run(context, (tx) => this.run(tx, context));
  }

  private async run(tx: LinePerformersTransaction, context: PerformersContext): Promise<ChangeLinePerformersResponse> {
    await this.authorize(tx, context);
    let canRead: boolean | undefined;
    const result = await tx.idempotent(async () => {
      const saved = await this.change(tx, context);
      canRead = saved.canRead;
      return saved.body;
    });
    // المعالج لا يشتغل عند إعادة الإرسال، فإعادة فحص الصلاحية تتم هنا داخل المعاملة قبل إرجاع الجسم المخزون.
    if (result.replayed) canRead = await this.recheck(tx, context);
    if (canRead === undefined) throw new Error('Performers change read missing');
    return projectPerformersChangeResponse(canRead, result.body.line, result.body.session);
  }

  private async authorize(tx: LinePerformersTransaction, context: PerformersContext): Promise<void> {
    const access = lineActorAccess(await tx.access.read(this.clock.now()));
    resolveSessionChanger(access, context.input.changer_membership_id ?? access.eligible_membership_ids[0]);
  }

  private async recheck(tx: LinePerformersTransaction, context: PerformersContext): Promise<boolean> {
    await tx.access.lock();
    const facts = await tx.access.read(this.clock.now());
    const access = lineActorAccess(facts);
    resolveSessionChanger(access, context.input.changer_membership_id ?? access.eligible_membership_ids[0]);
    if ((await tx.place.read()) === null) throw new SessionError('FORBIDDEN');
    return facts.can_read;
  }

  private async change(tx: LinePerformersTransaction, context: PerformersContext) {
    const locked = await this.loadLocked(tx, context);
    const decision = await this.decide(tx, context, locked);
    return this.persist(tx, context, locked, decision);
  }

  private async loadLocked(tx: LinePerformersTransaction, context: PerformersContext): Promise<LockedPerformers> {
    await tx.access.lock();
    await tx.lines.lockVisit(context.sessionId);
    const line = await tx.lines.loadLineForUpdate(context.sessionId, context.lineId);
    if (line === null) {
      // السلطة تسبق النطاق: سطر مجهول يبقى رفضاً موحّداً، لكن المنع أو الميزة يبقىان هما.
      const access = lineActorAccess(await tx.access.read(this.clock.now()));
      resolveSessionChanger(access, context.input.changer_membership_id ?? access.eligible_membership_ids[0]);
      throw new SessionError('FORBIDDEN');
    }
    const rows = await tx.lines.currentPerformers(context.sessionId, context.lineId);
    const retained = await tx.identities.retainedForLine(context.sessionId, context.lineId);
    const requested = context.input.performers.map((performer) => ({ employee_id: performer.employee_id }));
    const batches = identityLockBatches(rows, [...retained, ...requested]);
    for (const batch of batches) {
      await tx.performers.lock(batch);
    }
    return { line, rows, retained, batches };
  }

  private async decide(
    tx: LinePerformersTransaction,
    context: PerformersContext,
    locked: LockedPerformers,
  ): Promise<PerformersDecision> {
    const at = this.clock.now();
    const facts = await tx.access.read(at);
    const membershipId = resolveSessionChanger(lineActorAccess(facts), context.input.changer_membership_id);
    const changer = selectedLineMembership(facts, membershipId);
    if ((await tx.place.read()) === null) throw new SessionError('FORBIDDEN');
    const found = await this.readEmployees(tx, locked);
    if (missingCurrent(locked.rows, found)) throw new SessionError('FORBIDDEN');
    const prepared = evaluateLinePerformersChange({
      actor_user_id: context.userId,
      identities: {
        current: linePerformerIdentities(locked.rows, found),
        retained: linePerformerIdentities(locked.retained, found),
      },
      preparation: {
        line: { status: locked.line.status, revision: locked.line.revision, not_changeable: false },
        expected_revision: context.input.expected_revision,
        business_date: locked.line.business_date,
        now: at,
        business_timezone: locked.line.business_timezone,
        reason: context.input.reason,
        current_performers: locked.rows,
        requested_performers: context.input.performers,
        added_employees: addedEmployees(locked.rows, context.input.performers, found),
      },
    });
    return { facts, at, changer, prepared };
  }

  private async readEmployees(tx: LinePerformersTransaction, locked: LockedPerformers): Promise<SessionEmployee[]> {
    const found: SessionEmployee[] = [];
    for (const batch of locked.batches) {
      found.push(...(await tx.performers.read(batch, locked.line.occurred_at)));
    }
    return found;
  }

  private async persist(
    tx: LinePerformersTransaction,
    context: PerformersContext,
    locked: LockedPerformers,
    decision: PerformersDecision,
  ) {
    const changeId = this.ids.newId();
    const names = await tx.editors.read(context.userId);
    await tx.lines.insertChange(context.sessionId, context.lineId, changeInsert(changeId, locked, decision, names, context.userId));
    await tx.lines.insertSide(changeId, 'BEFORE', storedRows(locked.rows, this.ids));
    const updated = await tx.lines.bumpRevision(
      context.sessionId,
      context.lineId,
      context.input.expected_revision,
      decision.prepared.has_performer_warning,
    );
    if (!updated.changed || updated.revision !== decision.prepared.revision) {
      throw new Error('Performers change revision invariant');
    }
    await tx.lines.replacePerformers(context.sessionId, context.lineId, storedRows(decision.prepared.after, this.ids));
    await tx.lines.insertSide(changeId, 'AFTER', storedRows(decision.prepared.after, this.ids));
    const edited = await tx.lines.isPriceEdited(context.sessionId, context.lineId);
    const record = await tx.lines.loadSession(context.sessionId);
    if (record === null) throw new SessionError('FORBIDDEN');
    const saved = record.lines.find((item) => item.id === context.lineId);
    if (saved === undefined) throw new SessionError('FORBIDDEN');
    const body = savedLinePerformersChangeResponse(
      record,
      context.lineId,
      performersChangedMark(decision.at, locked.line.business_timezone),
      edited,
    );
    await tx.audit(this.ids.newId(), linePerformersAudit(auditInput(context, locked, decision, changeId)));
    await tx.emit(this.ids.newId(), context.sessionId, linePerformersEvent(eventInput(context, record, saved, decision)));
    return { canRead: decision.facts.can_read, body };
  }
}

function missingCurrent(rows: readonly LinePerformerRow[], found: readonly SessionEmployee[]): boolean {
  return rows.some((row) => !found.some((employee) => employee.id === row.employee_id));
}

function addedEmployees(
  rows: readonly LinePerformerRow[],
  requested: readonly { employee_id: string }[],
  found: readonly SessionEmployee[],
): SessionEmployee[] {
  const current = new Set(rows.map((row) => row.employee_id));
  const asked = new Set(requested.map((performer) => performer.employee_id));
  return found.filter((employee) => asked.has(employee.id) && !current.has(employee.id));
}

function storedRows(rows: readonly LinePerformerRow[], ids: IdGenerator): StoredPerformerRow[] {
  return rows.map((row) => ({ ...row, id: ids.newId() }));
}

function changeInsert(
  id: string,
  locked: LockedPerformers,
  decision: PerformersDecision,
  names: { name_ar: string | null; name_en: string } | null,
  userId: string,
): ServiceLinePerformerChangeInsert {
  return {
    id,
    previous_revision: locked.line.revision,
    revision: decision.prepared.revision,
    reason: decision.prepared.reason,
    changed_at: decision.at,
    changed_by: userId,
    changed_by_membership_id: decision.changer.membership_id,
    changer_name_ar: names?.name_ar ?? null,
    changer_name_en: names?.name_en ?? null,
    changer_role: decision.changer.role.code,
    changer_role_is_system: decision.changer.role.is_system,
    changer_role_name_ar: decision.changer.role.name_ar,
    changer_role_name_en: decision.changer.role.name_en,
  };
}

function auditInput(context: PerformersContext, locked: LockedPerformers, decision: PerformersDecision, changeId: string) {
  return {
    sessionId: context.sessionId,
    lineId: context.lineId,
    changeId,
    revisionBefore: locked.line.revision,
    changerUserId: context.userId,
    changerMembershipId: decision.changer.membership_id,
    changedAt: decision.at,
    performersBefore: decision.prepared.previous.performers,
    performersAfter: decision.prepared.after.map((row) => ({ employee_id: row.employee_id, share_bps: row.share_bps })),
  };
}

function eventInput(context: PerformersContext, record: SessionRecord, saved: SessionLine, decision: PerformersDecision) {
  return {
    record,
    line: saved,
    previous: decision.prepared.previous,
    changer: { userId: context.userId, membershipId: decision.changer.membership_id, at: decision.at },
  };
}
