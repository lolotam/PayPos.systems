import type { RecordServiceSessionInput, RecordServiceSessionResponse } from '@pospay/contracts';
import { sessionDrafts } from '../../domain/session-drafts.ts';
import { resolveSessionRecorder } from '../../domain/session-authority.ts';
import { SessionError } from '../../domain/session-error.ts';
import { sessionPreparationFacts } from '../../domain/prepare-session-lines.ts';
import { prepareVisitLines } from '../../domain/package-redemption.ts';
import { validatePerformerCardinality } from '../../domain/session-performers.ts';
import { sessionBusinessDate, sessionTime, visitInstant } from '../../domain/session-time.ts';
import { planSessionWrite, recordedSessionLine } from '../../domain/session-write.ts';
import { sessionSnapshot } from '../../domain/session-snapshot.ts';
import type { SessionRecord } from '../../domain/session-types.ts';
import type { SessionRecoveryPort } from '../../ports/session-recovery.port.ts';
import type { Clock, IdGenerator, ServiceSessionTransactions, SessionWriteContext, SessionTransaction } from '../../ports/service-session-transactions.port.ts';
import { approvalDecisions, commitDiscountApprovals, consumptionActor, lockApprovalProposals } from '../consume-discount-approval/consume-discount-approvals.ts';
import { assertPackageFactsAllowed, packagePreparedDrafts, packageRedemptionWrites, resolvePackageRedemptions } from '../redeem-package-session/package-redemption-write.ts';
export { SessionError } from '../../domain/session-error.ts';

type RecordContext = SessionWriteContext & { input: RecordServiceSessionInput };

/** يسجل زيارة واحدة؛ كل المقبول وأثره والرد المحفوظ يلتزمون معاً. */
export class RecordServiceSessionUseCase {
  constructor(private readonly transactions: ServiceSessionTransactions, private readonly recovery: SessionRecoveryPort, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  async execute(context: SessionWriteContext & { input: RecordServiceSessionInput }): Promise<RecordServiceSessionResponse> {
    await this.recovery.issue({
      companyId: context.companyId, userId: context.userId, businessId: context.businessId, branchId: context.branchId,
      operation: 'record-service-session', key: context.key, recorderMembershipId: context.input.recorder_membership_id,
      occurredAt: context.input.occurred_at === undefined ? undefined : new Date(context.input.occurred_at),
    });
    return this.transactions.run(context, async (tx) => {
      const place = await tx.place.read();
      if (place === null) throw new SessionError('FORBIDDEN');
      resolveSessionRecorder(await tx.access.read(this.clock.now()), context.input.recorder_membership_id, undefined, context.userId);
      const response = await tx.idempotent('record-service-session', () => this.record(tx, context));
      if (response.replayed) resolveSessionRecorder(await tx.access.read(this.clock.now()), context.input.recorder_membership_id, undefined, context.userId);
      return response.body;
    });
  }
  private async record(tx: SessionTransaction, context: SessionWriteContext & { input: RecordServiceSessionInput }): Promise<RecordServiceSessionResponse> {
    await tx.access.lock();
    const membershipId = resolveSessionRecorder(await tx.access.read(this.clock.now()), context.input.recorder_membership_id, undefined, context.userId);
    context.input.lines.forEach((line, input_index) => validatePerformerCardinality(line.performers, input_index));
    const serviceIds = context.input.lines.map((l) => l.service_id);
    const employeeIds = context.input.lines.flatMap((l) => l.performers.map((p) => p.employee_id));
    await tx.catalog.lock(serviceIds);
    await tx.performers.lock(employeeIds);
    const locked = await lockApprovalProposals(tx, context.input.lines);
    const place = await tx.place.read();
    if (place === null) throw new SessionError('FORBIDDEN');
    const customer = await tx.customer.read(context.input.customer_id);
    if (customer === null) throw new SessionError('SESSION_CUSTOMER_NOT_FOUND');
    const services = await tx.catalog.read(serviceIds);
    const firstAt = this.clock.now();
    const occurredAt = context.input.occurred_at === undefined ? firstAt : new Date(context.input.occurred_at);
    // لحظة الزيارة تُطبّع قبل أي حساب: نفس اللحظة التي ستُحفظ بها الزيارة.
    const provisional = visitInstant(occurredAt, firstAt);
    const employees = await tx.performers.read(employeeIds, provisional);
    const drafts = sessionDrafts(context.input.lines);
    // قفل الاستحقاقات هو آخر قفل مال، فينتظر على المكوّن؛ صلاحية الباقة تقاس بيوم الفرع لا بيوم النشاط.
    const facts = await resolvePackageRedemptions(tx, { customerId: customer.id, drafts: drafts.packages,
      visitLocalDate: sessionBusinessDate(provisional, place.branch_timezone), occurredAt: provisional, newId: () => this.ids.newId() });
    // بعد كل أقفال المال تقرأ الساعة والحد وتتأكد من السلطة، فلا يبقى انتظار قديم حياً.
    const at = this.clock.now();
    resolveSessionRecorder(await tx.access.read(at), membershipId, undefined, context.userId);
    const limit = await tx.discount.read(membershipId);
    const time = sessionTime(occurredAt, at, place.timezone);
    // الساعة تغيّرت بعد القفل، فيُعاد فحص انتهاء الباقة على اللحظة التي ستُحفظ بها الزيارة.
    assertPackageFactsAllowed(facts, sessionBusinessDate(time.occurred_at, place.branch_timezone), time.occurred_at);
    const prepared = prepareVisitLines(drafts.paid, packagePreparedDrafts(drafts.packages, facts),
      sessionPreparationFacts(services, employees, context.userId));
    const decisions = approvalDecisions(tx, { prepared, limit, terms: this.terms(context, membershipId, time.business_date), actor: consumptionActor(context, membershipId) }, locked, at);
    const plan = planSessionWrite(prepared, limit, [], tx.discountMessages, decisions);
    const sessionId = this.ids.newId();
    const lines = plan.accepted.map((line, i) => recordedSessionLine(line,
      { id: this.ids.newId(), session_id: sessionId, ordinal: plan.ordinals[i] as number, performer_ids: line.performers.map(() => this.ids.newId()) },
      { userId: context.userId, membershipId, at, late: time.late }, limit));
    const record: SessionRecord = { id: sessionId, business_id: context.businessId, branch_id: context.branchId, customer,
      recorded_by: context.userId, recorded_by_membership_id: membershipId, recorded_at: at, business_timezone: place.timezone, ...time, lines };
    await tx.repository.insertSession(record);
    await tx.repository.insertLines(lines);
    const redemptions = packageRedemptionWrites(lines, at, context.userId, membershipId);
    if (redemptions.redemptions.length > 0) {
      await tx.packages.writeRedemptions(redemptions.redemptions);
      await tx.packages.markSlotsUsed(redemptions.slots);
    }
    await commitDiscountApprovals(tx, lines, decisions, at);
    await tx.audit(record, lines, plan.outcome, false);
    await tx.emit(record, lines, false);
    return { outcome: plan.outcome, session: sessionSnapshot(record), rejected_lines: plan.rejected_lines };
  }
  /** شروط الاستهلاك لزيارة جديدة: بلا زيارة، واليوم من لحظة الزيارة كما حسبها التسجيل. */
  private terms(context: RecordContext, membershipId: string, businessDate: string) {
    return { company_id: context.companyId, business_id: context.businessId, branch_id: context.branchId,
      customer_id: context.input.customer_id, session_id: null, requested_by: context.userId,
      requested_by_membership_id: membershipId, occurred_business_date: businessDate };
  }
}
