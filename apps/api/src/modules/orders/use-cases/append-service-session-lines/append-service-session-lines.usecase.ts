import type { AppendServiceSessionLinesInput, AppendServiceSessionLinesResponse } from '@pospay/contracts';
import { resolveSessionRecorder } from '../../domain/session-authority.ts';
import { SessionError } from '../../domain/session-error.ts';
import { sessionPreparationFacts } from '../../domain/prepare-session-lines.ts';
import { prepareVisitLines } from '../../domain/package-redemption.ts';
import { validatePerformerCardinality } from '../../domain/session-performers.ts';
import { sessionBusinessDate, sessionTime, validateAppendWindow } from '../../domain/session-time.ts';
import { planSessionWrite, recordedSessionLine } from '../../domain/session-write.ts';
import { sessionLineSnapshot, sessionSnapshot } from '../../domain/session-snapshot.ts';
import type { SessionRecord } from '../../domain/session-types.ts';
import type { SessionRecoveryPort } from '../../ports/session-recovery.port.ts';
import type { Clock, IdGenerator, ServiceSessionTransactions, SessionWriteContext, SessionTransaction } from '../../ports/service-session-transactions.port.ts';
import { sessionDrafts } from '../../domain/session-drafts.ts';
import { approvalDecisions, commitDiscountApprovals, consumptionActor, lockApprovalProposals } from '../consume-discount-approval/consume-discount-approvals.ts';
import { assertPackageFactsAllowed, packagePreparedDrafts, packageRedemptionWrites, resolvePackageRedemptions, type PackageRedemptionFact } from '../redeem-package-session/package-redemption-write.ts';

type AppendContext = SessionWriteContext & { sessionId: string; input: AppendServiceSessionLinesInput };
/** يضيف المصحح أو الخدمة الجديدة لنفس الزيارة دون تغيير أي بند محفوظ. */
export class AppendServiceSessionLinesUseCase {
  constructor(private readonly transactions: ServiceSessionTransactions, private readonly recovery: SessionRecoveryPort, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  async execute(context: AppendContext): Promise<AppendServiceSessionLinesResponse> {
    await this.recovery.issue({
      companyId: context.companyId, userId: context.userId, businessId: context.businessId, branchId: context.branchId,
      operation: 'append-service-session-lines', key: context.key, sessionId: context.sessionId,
      recorderMembershipId: context.input.recorder_membership_id,
    });
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
    context.input.lines.forEach((line, input_index) => validatePerformerCardinality(line.performers, input_index));
    const serviceIds = context.input.lines.map((l) => l.service_id);
    const employeeIds = context.input.lines.flatMap((l) => l.performers.map((p) => p.employee_id));
    await tx.catalog.lock(serviceIds);
    await tx.performers.lock(employeeIds);
    const locked = await lockApprovalProposals(tx, context.input.lines);
    const place = await tx.place.read();
    if (place === null) throw new SessionError('FORBIDDEN');
    const services = await tx.catalog.read(serviceIds);
    const employees = await tx.performers.read(employeeIds, original.occurred_at);
    const drafts = sessionDrafts(context.input.lines);
    // قفل الاستحقاقات هو آخر قفل مال؛ صلاحية الباقة تقاس بيوم فرع الزيارة لا بيوم النشاط.
    // توقيت الفرع يُقرأ وحده عند وجود مسودة باقة، فالإضافة المدفوعة ما تدفعش الاستعلام ده.
    let facts = new Map<number, PackageRedemptionFact>();
    if (drafts.packages.length > 0) {
      const branchTimezone = await tx.place.branchTimezone();
      if (branchTimezone === null) throw new SessionError('FORBIDDEN');
      facts = await resolvePackageRedemptions(tx, { customerId: original.customer.id, drafts: drafts.packages,
        newId: () => this.ids.newId() });
      assertPackageFactsAllowed(facts, sessionBusinessDate(original.occurred_at, branchTimezone), original.occurred_at);
    }
    // بعد كل أقفال المال تقرأ الساعة والحد وتتأكد من السلطة، فلا يبقى انتظار قديم حياً.
    const at = this.clock.now();
    resolveSessionRecorder(await tx.access.read(at), membershipId, original.recorded_by, context.userId);
    const limit = await tx.discount.read(membershipId);
    validateAppendWindow(original.business_date, at, original.business_timezone);
    const time = sessionTime(original.occurred_at, at, original.business_timezone);
    const prepared = prepareVisitLines(drafts.paid, packagePreparedDrafts(drafts.packages, facts),
      sessionPreparationFacts(services, employees, context.userId));
    const decisions = approvalDecisions(tx, { prepared, limit, terms: this.terms(context, original, membershipId), actor: consumptionActor(context, membershipId) }, locked, at);
    const plan = planSessionWrite(prepared, limit, original.lines, tx.discountMessages, decisions);
    const lines = plan.accepted.map((line, i) => recordedSessionLine(line,
      { id: this.ids.newId(), session_id: original.id, ordinal: plan.ordinals[i] as number, performer_ids: line.performers.map(() => this.ids.newId()) },
      { userId: context.userId, membershipId, at, late: time.late }, limit));
    const record = { ...original, lines: [...original.lines, ...lines] };
    await tx.repository.insertLines(lines);
    const redemptions = packageRedemptionWrites(lines, at, context.userId, membershipId);
    if (redemptions.redemptions.length > 0) {
      await tx.packages.writeRedemptions(redemptions.redemptions);
      await tx.packages.markSlotsUsed(redemptions.slots);
    }
    await commitDiscountApprovals(tx, lines, decisions, at);
    await tx.audit(record, lines, plan.outcome, true);
    await tx.emit(record, lines, true);
    return { outcome: plan.outcome, session: sessionSnapshot(record), added_lines: lines.map(sessionLineSnapshot), rejected_lines: plan.rejected_lines };
  }
  /** شروط الاستهلاك لزيارة محفوظة: هي نفسها وتاريخها وعميلتها كما حُفظت. */
  private terms(context: AppendContext, original: SessionRecord, membershipId: string) {
    return { company_id: context.companyId, business_id: context.businessId, branch_id: context.branchId,
      customer_id: original.customer.id, session_id: original.id, requested_by: context.userId,
      requested_by_membership_id: membershipId, occurred_business_date: original.business_date };
  }
}
