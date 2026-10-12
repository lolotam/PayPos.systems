import type { AppendServiceSessionLinesInput, AppendServiceSessionLinesResponse } from '@pospay/contracts';
import { resolveSessionRecorder } from '../../domain/session-authority.ts';
import { SessionError } from '../../domain/session-error.ts';
import { prepareSessionLines } from '../../domain/prepare-session-lines.ts';
import { sessionTime, validateAppendWindow } from '../../domain/session-time.ts';
import { planSessionWrite, recordedSessionLine } from '../../domain/session-write.ts';
import { sessionLineSnapshot, sessionSnapshot } from '../../domain/session-snapshot.ts';
import type { Clock, IdGenerator, ServiceSessionTransactions, SessionWriteContext, SessionTransaction } from '../../ports/service-session-transactions.port.ts';
import { sessionDrafts } from '../record-service-session/record-service-session.usecase.ts';

type AppendContext = SessionWriteContext & { sessionId: string; input: AppendServiceSessionLinesInput };
/** يضيف المصحح أو الخدمة الجديدة لنفس الزيارة دون تغيير أي بند محفوظ. */
export class AppendServiceSessionLinesUseCase {
  constructor(private readonly transactions: ServiceSessionTransactions, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  execute(context: AppendContext): Promise<AppendServiceSessionLinesResponse> {
    return this.transactions.run(context, async (tx) => {
      if (await tx.place.read() === null) throw new SessionError('FORBIDDEN');
      const record = await tx.repository.load(context.sessionId);
      if (record === null) throw new SessionError('FORBIDDEN');
      resolveSessionRecorder(await tx.access.read(this.clock.now()), context.input.recorder_membership_id, record.recorded_by, context.userId);
      const response = await tx.idempotent('append-service-session-lines', () => this.append(tx, context));
      if (response.replayed) resolveSessionRecorder(await tx.access.read(this.clock.now()), context.input.recorder_membership_id, record.recorded_by, context.userId);
      return response.body;
    });
  }
  authorize(context: SessionWriteContext & { sessionId: string; membershipId?: string }): Promise<void> {
    return this.transactions.run(context, async (tx) => {
      if (await tx.place.read() === null) throw new SessionError('FORBIDDEN');
      const record = await tx.repository.load(context.sessionId);
      if (record === null) throw new SessionError('FORBIDDEN');
      resolveSessionRecorder(await tx.access.read(this.clock.now()), context.membershipId, record.recorded_by, context.userId);
    });
  }
  private async append(tx: SessionTransaction, context: AppendContext): Promise<AppendServiceSessionLinesResponse> {
    await tx.access.lock();
    await tx.repository.lock(context.sessionId);
    const original = await tx.repository.load(context.sessionId);
    if (original === null) throw new SessionError('FORBIDDEN');
    const membershipId = resolveSessionRecorder(await tx.access.read(this.clock.now()), context.input.recorder_membership_id, original.recorded_by, context.userId);
    const serviceIds = context.input.lines.map((l) => l.service_id);
    const employeeIds = context.input.lines.flatMap((l) => l.performers.map((p) => p.employee_id));
    await tx.catalog.lock(serviceIds);
    await tx.performers.lock(employeeIds);
    const limit = await tx.discount.read(membershipId);
    const at = this.clock.now();
    resolveSessionRecorder(await tx.access.read(at), membershipId, original.recorded_by, context.userId);
    if (await tx.place.read() === null) throw new SessionError('FORBIDDEN');
    validateAppendWindow(original.business_date, at, original.business_timezone);
    const time = sessionTime(original.occurred_at, at, original.business_timezone);
    const services = await tx.catalog.read(serviceIds);
    const employees = await tx.performers.read(employeeIds, original.occurred_at);
    const plan = planSessionWrite(prepareSessionLines(sessionDrafts(context.input.lines), services, employees, context.userId), limit, original.lines, tx.discountMessages);
    const lines = plan.accepted.map((line, i) => recordedSessionLine(line,
      { id: this.ids.newId(), session_id: original.id, ordinal: plan.ordinals[i] as number, performer_ids: line.performers.map(() => this.ids.newId()) },
      { userId: context.userId, membershipId, at, late: time.late }, limit));
    const record = { ...original, lines: [...original.lines, ...lines] };
    await tx.repository.insertLines(lines);
    await tx.audit(record, lines, plan.outcome, true);
    await tx.emit(record, lines, true);
    return { outcome: plan.outcome, session: sessionSnapshot(record), added_lines: lines.map(sessionLineSnapshot), rejected_lines: plan.rejected_lines };
  }
}
