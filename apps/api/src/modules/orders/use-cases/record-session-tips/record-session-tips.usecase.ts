import type { RecordSessionTipsInput, SessionTips } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { ascendingEmployeeIds, employeeIdBatches } from '../../domain/employee-order.ts';
import { resolveSessionRecorder, type SessionAccess } from '../../domain/session-authority.ts';
import { SessionError } from '../../domain/session-error.ts';
import { withCurrentLinks, type TipPerformerRow } from '../../domain/tip-people-links.ts';
import {
  sessionTipsAudit,
  sessionTipsChangedEvent,
  tipSetResponse,
  type TipRevisionSession,
} from '../../domain/tip-records.ts';
import { assertTipChange, assertTipRevision, nextTipRevision } from '../../domain/tip-revision.ts';
import { validateTipSet, type TipEntry } from '../../domain/tip-set.ts';
import { assertTipWindowOpen } from '../../domain/tip-window.ts';
import { tipReasonFor } from '../../domain/written-reason.ts';
import type {
  SessionTipsCurrent,
  SessionTipsTransaction,
  SessionTipsTransactions,
} from '../../ports/session-tips.port.ts';
import type {
  Clock,
  IdGenerator,
  SessionWriteContext,
} from '../../ports/service-session-transactions.port.ts';

/** حد قارئ الموارد البشرية؛ أي دفعة أكبر يرفضها قبل القراءة. */
const PERFORMER_BATCH = 80;

type TipContext = SessionWriteContext & { sessionId: string; input: RecordSessionTipsInput };
type LoadedEmployees = Awaited<ReturnType<SessionTipsTransaction['performers']['read']>>;

interface LoadedTips {
  session: TipRevisionSession;
  current: SessionTipsCurrent;
  rows: readonly TipPerformerRow[];
  employees: LoadedEmployees;
}

interface TipDecision {
  reason: string | null;
  revision: number;
  previous_revision: number | null;
  requested: readonly TipEntry[];
}

/** يسجّل مجموعة بقشيش الزيارة كمراجعة جديدة داخل معاملة واحدة. */
export class RecordSessionTipsUseCase {
  constructor(
    private readonly transactions: SessionTipsTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(context: TipContext): Promise<SessionTips> {
    return this.transactions.run(context, (tx) => this.open(tx, context));
  }

  private async open(tx: SessionTipsTransaction, context: TipContext): Promise<SessionTips> {
    await this.authorize(tx, context);
    const result = await tx.idempotent(() => this.record(tx, context));
    if (!result.replayed) return result.body;
    // إعادة الإرسال بتقفل صفوف الصلاحية زي الكتابة الأصلية، عشان سحب صلاحية متزامن يتشاف قبل ما يرجع الجسم المحفوظ.
    await tx.access.lock();
    await this.authorize(tx, context);
    return result.body;
  }

  private async authorize(tx: SessionTipsTransaction, context: TipContext): Promise<void> {
    if ((await tx.place.read()) === null) throw new SessionError('SESSION_NOT_FOUND');
    acceptRecorder(
      await tx.access.read(this.clock.now()),
      context.input.recorder_membership_id,
      context.userId,
    );
  }

  private async record(tx: SessionTipsTransaction, context: TipContext): Promise<SessionTips> {
    const requested = requestedEntries(context.input.tips);
    const loaded = await this.load(tx, context, requested);
    const at = this.clock.now();
    const membershipId = await this.recheck(tx, context, at);
    return this.commit(
      tx,
      context,
      loaded,
      decideTips(loaded, context, requested, at),
      membershipId,
      at,
    );
  }

  private async load(
    tx: SessionTipsTransaction,
    context: TipContext,
    requested: readonly TipEntry[],
  ): Promise<LoadedTips> {
    await tx.access.lock();
    await tx.tips.lockVisit(context.sessionId);
    const session = await tx.tips.loadSession(context.sessionId);
    if (session === null) throw new SessionError('SESSION_NOT_FOUND');
    const rows = await tx.tips.loadPeople(context.sessionId);
    const current = await tx.tips.loadCurrent(context.sessionId);
    const employees = await readPerformers(
      tx,
      performerIds(rows, current.entries, requested),
      session.occurred_at,
    );
    return { session, current, rows, employees };
  }

  private async recheck(
    tx: SessionTipsTransaction,
    context: TipContext,
    at: Date,
  ): Promise<string> {
    const membershipId = acceptRecorder(
      await tx.access.read(at),
      context.input.recorder_membership_id,
      context.userId,
    );
    if ((await tx.place.read()) === null) throw new SessionError('SESSION_NOT_FOUND');
    return membershipId;
  }

  private async commit(
    tx: SessionTipsTransaction,
    context: TipContext,
    loaded: LoadedTips,
    decision: TipDecision,
    membershipId: string,
    at: Date,
  ): Promise<SessionTips> {
    const eventId = this.ids.newId();
    await tx.tips.insertRevision(context.sessionId, {
      id: this.ids.newId(),
      event_id: eventId,
      revision: decision.revision,
      previous_revision: decision.previous_revision,
      changed_by: context.userId,
      changed_by_membership_id: membershipId,
      changed_at: at,
      reason: decision.reason,
      entries: decision.requested.map((entry) => ({ ...entry, id: this.ids.newId() })),
    });
    const before = loaded.current.revision === 0 ? null : loaded.current;
    const after = { revision: decision.revision, entries: decision.requested };
    await tx.audit(this.ids.newId(), sessionTipsAudit(context.sessionId, before, after));
    await tx.emit(
      eventId,
      context.sessionId,
      sessionTipsChangedEvent(loaded.session, decision.revision, at, decision.requested),
    );
    return tipSetResponse(decision.revision, decision.requested);
  }
}

function acceptRecorder(
  access: SessionAccess,
  selection: string | undefined,
  userId: string,
): string {
  try {
    return resolveSessionRecorder(access, selection, undefined, userId);
  } catch (error) {
    if (error instanceof SessionError && error.code === 'FORBIDDEN')
      throw new SessionError('SESSION_NOT_FOUND');
    throw error;
  }
}

function decideTips(
  loaded: LoadedTips,
  context: TipContext,
  requested: readonly TipEntry[],
  at: Date,
): TipDecision {
  assertTipRevision(loaded.current.revision, context.input.expected_revision);
  const people = withCurrentLinks(
    loaded.rows,
    loaded.employees,
    linkIds(loaded.rows, loaded.current.entries),
  );
  assertTipWindowOpen(loaded.session.business_date, at, loaded.session.business_timezone);
  const reason = tipReasonFor(loaded.current.revision, context.input.reason);
  const result = validateTipSet({
    actor_user_id: context.userId,
    current: loaded.current.entries,
    requested,
    people,
  });
  assertTipChange(result.changed_anything);
  const next = nextTipRevision(loaded.current.revision);
  return { reason, revision: next.revision, previous_revision: next.previous_revision, requested };
}

function requestedEntries(tips: RecordSessionTipsInput['tips']): TipEntry[] {
  return tips.map((tip) => ({
    employee_id: tip.employee_id,
    method: tip.method,
    amount: parsedAmount(tip.amount),
  }));
}

function parsedAmount(amount: string): bigint {
  try {
    return parseMoney(amount);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      throw new SessionError('VALIDATION_FAILED');
    }
    throw error;
  }
}

function performerIds(
  rows: readonly TipPerformerRow[],
  current: readonly TipEntry[],
  requested: readonly TipEntry[],
): string[] {
  return ascendingEmployeeIds(
    rows.map((row) => row.employee_id),
    current.map((entry) => entry.employee_id),
    requested.map((entry) => entry.employee_id),
  );
}

function linkIds(rows: readonly TipPerformerRow[], current: readonly TipEntry[]): string[] {
  return ascendingEmployeeIds(
    rows.map((row) => row.employee_id),
    current.map((entry) => entry.employee_id),
  );
}

async function readPerformers(
  tx: SessionTipsTransaction,
  employeeIds: readonly string[],
  at: Date,
): Promise<LoadedEmployees> {
  const batches = employeeIdBatches(employeeIds, PERFORMER_BATCH);
  const employees: LoadedEmployees = [];
  for (const batch of batches) await tx.performers.lock(batch);
  for (const batch of batches) employees.push(...(await tx.performers.read(batch, at)));
  return employees;
}
