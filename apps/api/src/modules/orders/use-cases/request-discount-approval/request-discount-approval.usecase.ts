import type { RequestDiscountApprovalInput, RequestDiscountApprovalResponse } from '@pospay/contracts';
import { planDiscountRequest, requesterRole, type DiscountProposalPlan, type DiscountRequesterRole } from '../../domain/discount-request.ts';
import {
  discountRequestAudits,
  discountRequestEvent,
  discountRequestResponse,
} from '../../domain/discount-request-records.ts';
import { resolveSessionRecorder } from '../../domain/session-authority.ts';
import { sessionDrafts } from '../../domain/session-drafts.ts';
import { SessionError } from '../../domain/session-error.ts';
import { validatePerformerCardinality } from '../../domain/session-performers.ts';
import { prepareSessionLines } from '../../domain/prepare-session-lines.ts';
import { sessionTime, validateAppendWindow } from '../../domain/session-time.ts';
import type { PreparedSessionLine, SessionLimit, SessionRecord } from '../../domain/session-types.ts';
import type {
  DiscountRequestTransaction,
  DiscountRequestTransactions,
  TermsHashPort,
} from '../../ports/discount-request.port.ts';
import type { Clock, IdGenerator, SessionWriteContext } from '../../ports/service-session-transactions.port.ts';

export { DiscountApprovalError } from '../../domain/discount-approval-error.ts';

type RequestContext = SessionWriteContext & { input: RequestDiscountApprovalInput };

interface LineIdentities {
  serviceIds: string[];
  employeeIds: string[];
}

interface PlanFacts {
  requestId: string;
  membershipId: string;
  limit: SessionLimit;
  at: Date;
  sessionId: string | null;
  occurredAt: Date;
  businessDate: string;
  customerName: string;
  prepared: PreparedSessionLine[];
  role: DiscountRequesterRole;
  nameEn: string | null;
  nameAr: string | null;
}

/** يطلب موافقة على بنود فوق حدّ المسجّلة، ويخزّن اقتراحاً لكل بند في معاملة واحدة. */
export class RequestDiscountApprovalUseCase {
  constructor(
    private readonly transactions: DiscountRequestTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly hash: TermsHashPort,
  ) {}

  async execute(context: RequestContext): Promise<RequestDiscountApprovalResponse> {
    return this.transactions.run(context, async (tx) => {
      if (await tx.place.read() === null) throw new SessionError('FORBIDDEN');
      resolveSessionRecorder(await tx.access.read(this.clock.now()), context.input.requester_membership_id, undefined, context.userId);
      const response = await tx.idempotent(() => this.request(tx, context));
      if (response.replayed) {
        resolveSessionRecorder(await tx.access.read(this.clock.now()), context.input.requester_membership_id, undefined, context.userId);
      }
      return response.body;
    });
  }

  private async request(tx: DiscountRequestTransaction, context: RequestContext): Promise<RequestDiscountApprovalResponse> {
    await tx.access.lock();
    const membershipId = resolveSessionRecorder(await tx.access.read(this.clock.now()), context.input.requester_membership_id, undefined, context.userId);
    const session = await this.visit(tx, context);
    const lines = this.lineIdentities(context);
    await tx.catalog.lock(lines.serviceIds);
    await tx.performers.lock(lines.employeeIds);
    const limit = await tx.discount.read(membershipId);
    const at = this.clock.now();
    const access = await tx.access.read(at);
    resolveSessionRecorder(access, membershipId, undefined, context.userId);
    const place = await tx.place.read();
    if (place === null) throw new SessionError('FORBIDDEN');
    const time = this.visitTime(session, context, at, place.timezone);
    const customer = await tx.customer.read(context.input.customer_id);
    if (customer === null) throw new SessionError('SESSION_CUSTOMER_NOT_FOUND');
    const prepared = await this.prepare(tx, context, lines, time.occurred_at);
    const names = await tx.requesterName.read(context.userId);
    const requestId = this.ids.newId();
    const proposals = this.plan(context, {
      requestId, membershipId, limit, at, sessionId: session?.id ?? null,
      occurredAt: time.occurred_at, businessDate: time.business_date, customerName: customer.name, prepared,
      role: requesterRole(access.memberships, membershipId), nameEn: names?.name_en ?? null, nameAr: names?.name_ar ?? null,
    });
    await tx.proposals.insert(proposals);
    await tx.audit(discountRequestAudits(proposals));
    await tx.emit(requestId, discountRequestEvent(proposals, {
      request_id: requestId, business_id: context.businessId, branch_id: context.branchId,
      requested_by: context.userId, occurred_at: time.occurred_at,
    }));
    return discountRequestResponse(requestId, time.occurred_at, proposals);
  }

  /** الزيارة المرفقة بالطلب تُقرأ داخل نطاق النشاط والفرع فقط، وإلا فالرفض موحّد بلا كاشف وجود. */
  private async visit(tx: DiscountRequestTransaction, context: RequestContext): Promise<SessionRecord | null> {
    const sessionId = context.input.session_id;
    if (sessionId === undefined) return null;
    const loaded = await tx.sessions.load(sessionId);
    if (loaded === null) throw new SessionError('FORBIDDEN');
    await tx.sessions.lock(loaded.id);
    const locked = await tx.sessions.load(loaded.id);
    if (locked === null) throw new SessionError('FORBIDDEN');
    if (locked.customer.id !== context.input.customer_id) throw new SessionError('FORBIDDEN');
    return locked;
  }

  /** مع الزيارة: لحظةها ويومها؛ وبدونها: لحظة الطلب أو الآن المحقون بعد التطبيع. */
  private visitTime(
    session: SessionRecord | null,
    context: RequestContext,
    at: Date,
    timezone: string,
  ) {
    if (session !== null) {
      validateAppendWindow(session.business_date, at, session.business_timezone);
      return { occurred_at: session.occurred_at, business_date: session.business_date };
    }
    const time = sessionTime(
      context.input.occurred_at === undefined ? undefined : new Date(context.input.occurred_at),
      at,
      timezone,
    );
    return { occurred_at: time.occurred_at, business_date: time.business_date };
  }

  /** عدد المنفّذات ونسبهن يُفحص قبل أي قراءة، كما في التسجيل. */
  private lineIdentities(context: RequestContext): LineIdentities {
    context.input.lines.forEach((line, input_index) => validatePerformerCardinality(line.performers, input_index));
    return {
      serviceIds: context.input.lines.map((line) => line.service_id),
      employeeIds: context.input.lines.flatMap((line) => line.performers.map((performer) => performer.employee_id)),
    };
  }

  /** تحضير البنود بدوال التسجيل نفسها، فالسطر المكتوب لاحقاً يطابق ما وافقت عليه الموافقة. */
  private async prepare(
    tx: DiscountRequestTransaction,
    context: RequestContext,
    lines: LineIdentities,
    occurredAt: Date,
  ): Promise<PreparedSessionLine[]> {
    const services = await tx.catalog.read(lines.serviceIds);
    const employees = await tx.performers.read(lines.employeeIds, occurredAt);
    return prepareSessionLines(sessionDrafts(context.input.lines), services, employees, context.userId);
  }

  /** بناء الاقتراحات بمعرّفات جديدة وبشروط مبنية من البنود المحضّرة. */
  private plan(context: RequestContext, facts: PlanFacts): DiscountProposalPlan[] {
    return planDiscountRequest({
      lines: facts.prepared,
      limit: facts.limit,
      company_id: context.companyId,
      business_id: context.businessId,
      branch_id: context.branchId,
      customer_id: context.input.customer_id,
      session_id: facts.sessionId,
      occurred_at: facts.occurredAt,
      occurred_business_date: facts.businessDate,
      requested_at: facts.at,
      requested_by: context.userId,
      requested_by_membership_id: facts.membershipId,
      requester: { role: facts.role, name_en: facts.nameEn, name_ar: facts.nameAr },
      customer_name: facts.customerName,
      request_id: facts.requestId,
      proposal_ids: facts.prepared.map(() => this.ids.newId()),
      performer_row_ids: facts.prepared.flatMap((line) => line.performers.map(() => this.ids.newId())),
      sha256Hex: (text) => this.hash.sha256Hex(text),
    });
  }
}
