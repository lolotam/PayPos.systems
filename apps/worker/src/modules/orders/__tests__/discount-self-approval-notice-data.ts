import { discountApprovedByPerformer } from '@pospay/contracts';
import { appendOutboxEvent, type ClaimedEvent } from '@pospay/db';
import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import type { DiscountSelfApprovalNoticeEvent } from '../ports/discount-self-approval-notice.port.ts';
import type {
  ApprovalRequester,
  ApprovalScope,
  DiscountApprovalContext,
} from './discount-approval-notice-data.ts';

export interface SelfApprovalProposalSpec {
  readonly bps?: number;
  readonly performer?: boolean | null;
  readonly status?: 'PENDING' | 'REJECTED' | 'APPROVED' | 'CONSUMED';
  readonly decidedBy?: ApprovalRequester;
}

export interface SelfApprovalSpec {
  readonly scope?: ApprovalScope;
  readonly proposals?: readonly SelfApprovalProposalSpec[];
  readonly decidedBy?: ApprovalRequester;
  readonly eventBps?: number;
  readonly eventService?: string;
  readonly eventDecidedBy?: string;
  readonly eventVia?: 'PIN' | 'REMOTE';
  readonly eventBranch?: string;
  readonly eventBusiness?: string;
  readonly extraEventProposal?: boolean;
  readonly unknownId?: boolean;
  readonly malformed?: boolean;
}

interface StoredProposal {
  readonly id: string;
  readonly bps: number;
  readonly decidedBy: ApprovalRequester;
}

export interface PreparedSelfApproval {
  readonly event: ClaimedEvent;
  readonly proposalIds: readonly string[];
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly approverUser: string;
  readonly approverMembership: string;
}

export function selfApprovalData(context: DiscountApprovalContext) {
  return {
    selfApproval: (spec: SelfApprovalSpec = {}) => prepare(context, spec),
    noticeEvent: (prepared: PreparedSelfApproval): DiscountSelfApprovalNoticeEvent => {
      const payload = discountApprovedByPerformer.parse(prepared.event.payload);
      return {
        companyId: prepared.companyId,
        sourceEventId: prepared.event.id,
        businessId: payload.business_id,
        branchId: payload.branch_id,
        decidedBy: payload.decided_by,
        deciderLabelAr: payload.decider_label_ar,
        deciderLabelEn: payload.decider_label_en,
        decidedVia: payload.decided_via,
        proposals: payload.proposals.map((proposal) => ({
          id: proposal.id,
          serviceId: proposal.service_id,
          nameAr: proposal.name_ar,
          nameEn: proposal.name_en,
          effectiveBps: proposal.effective_bps,
        })),
      };
    },
  };
}

async function prepare(
  context: DiscountApprovalContext,
  spec: SelfApprovalSpec,
): Promise<PreparedSelfApproval> {
  const scope = spec.scope ?? defaultScope();
  const decidedBy = spec.decidedBy ?? { userId: USER, membershipId: ORDER_IDS.membership };
  const requestId = context.ids.newId();
  const stored: StoredProposal[] = [];
  const proposalSpecs = spec.proposals ?? [{}];
  for (const [index, proposal] of proposalSpecs.entries()) {
    const decider = proposal.decidedBy ?? decidedBy;
    const bps = proposal.bps ?? (index === 0 ? 2000 : 1000);
    const id = await insertPending(context, scope, requestId, index, bps, decider);
    const status = proposal.status ?? 'APPROVED';
    await decide(context, scope.company, id, status, decider, proposal.performer);
    if (status === 'CONSUMED') await consumeProposal(context, scope, id, decider);
    stored.push({ id, bps, decidedBy: decider });
  }
  const payload = spec.malformed
    ? { broken: true }
    : eventPayload(context, spec, scope, stored, decidedBy);
  const aggregateId = stored[0]?.id ?? requestId;
  const event = await storeEvent(context, scope.company, aggregateId, payload);
  return {
    event,
    proposalIds: stored.map((proposal) => proposal.id),
    companyId: scope.company,
    businessId: scope.business,
    branchId: scope.branch,
    approverUser: stored[0]?.decidedBy.userId ?? decidedBy.userId,
    approverMembership: stored[0]?.decidedBy.membershipId ?? decidedBy.membershipId,
  };
}

function defaultScope(): ApprovalScope {
  return {
    company: TENANT.A.company,
    business: TENANT.A.business,
    branch: TENANT.A.branch,
    service: ORDER_IDS.service,
    customer: ORDER_IDS.customer,
  };
}

function eventPayload(
  context: DiscountApprovalContext,
  spec: SelfApprovalSpec,
  scope: ApprovalScope,
  stored: readonly StoredProposal[],
  decidedBy: ApprovalRequester,
) {
  const proposals = stored.map((proposal, index) => ({
    id: spec.unknownId && index === 0 ? context.ids.newId() : proposal.id,
    service_id: index === 0 ? (spec.eventService ?? scope.service) : scope.service,
    name_en: 'Synthetic service',
    name_ar: null,
    effective_bps: index === 0 ? (spec.eventBps ?? proposal.bps) : proposal.bps,
  }));
  const first = proposals[0];
  if (spec.extraEventProposal && first) proposals.push({ ...first, id: context.ids.newId() });
  return {
    schema_version: 1 as const,
    business_id: spec.eventBusiness ?? scope.business,
    branch_id: spec.eventBranch ?? scope.branch,
    decided_by: spec.eventDecidedBy ?? stored[0]?.decidedBy.userId ?? decidedBy.userId,
    decider_label_en: 'Synthetic owner',
    decider_label_ar: 'مالك تجريبي',
    decided_via: spec.eventVia ?? ('REMOTE' as const),
    proposals,
  };
}

async function insertPending(
  context: DiscountApprovalContext,
  scope: ApprovalScope,
  requestId: string,
  index: number,
  bps: number,
  requester: ApprovalRequester,
): Promise<string> {
  const id = context.ids.newId();
  const hash = `${context.ids.newId().replace(/-/g, '')}${context.ids.newId().replace(/-/g, '')}`;
  await context.owner`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_role,requester_role_is_system,requester_role_name_en,
    customer_first_name,requested_at,status,expires_at)
    VALUES(${scope.company},${id},${scope.business},${scope.branch},${requestId},${index},'RECORD',NULL,${context.at},
      ${scope.customer},${scope.service},'Synthetic service','{}'::jsonb,${hash},${bps},${requester.userId},${requester.membershipId},
      'PERSON',1000,'cashier',true,'Cashier','Synthetic',${context.at},'PENDING',${new Date(context.at.getTime() + 86_400_000)})`;
  return id;
}

async function decide(
  context: DiscountApprovalContext,
  companyId: string,
  proposalId: string,
  status: NonNullable<SelfApprovalProposalSpec['status']>,
  decider: ApprovalRequester,
  performer: boolean | null = true,
): Promise<void> {
  if (status === 'PENDING') return;
  const approved = status !== 'REJECTED';
  await context.owner`UPDATE discount_proposals SET status=${approved ? 'APPROVED' : 'REJECTED'},
    decided_by=${decider.userId},decided_by_membership_id=${decider.membershipId},decided_via='REMOTE',decided_device_id=NULL,
    decider_role='owner',decider_role_is_system=true,decider_role_name_en='Synthetic role',decided_at=${context.at},
    approved_limit_source=${approved ? 'OWNER' : null},approved_limit_bps=NULL,
    approver_is_performer=${approved ? (performer ?? true) : null},reject_reason=${approved ? null : 'Synthetic rejection'}
    WHERE company_id=${companyId} AND id=${proposalId}`;
}

async function consumeProposal(
  context: DiscountApprovalContext,
  scope: ApprovalScope,
  proposalId: string,
  decider: ApprovalRequester,
): Promise<void> {
  const sessionId = context.ids.newId();
  const lineId = context.ids.newId();
  const employeeId = context.ids.newId();
  await context.owner.begin(async (tx) => {
    await tx`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
      VALUES(${scope.company},${employeeId},${scope.business},${scope.branch},'Synthetic performer','synthetic performer','staff','2026-01-01',
        (SELECT COALESCE(MAX(employee_number),0)+1 FROM employees WHERE company_id=${scope.company}))`;
    await tx`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
      recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,business_timezone,late)
      VALUES(${scope.company},${sessionId},${scope.business},${scope.branch},${scope.customer},'Synthetic customer','***123',
        ${decider.userId},${decider.membershipId},${context.at},${context.at},'2026-10-16','Asia/Kuwait',false)`;
    await tx`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
      list_price,price,discount,net,effective_discount_bps,limit_source,limit_bps_applied,name_en,catalog_revision,
      rule_kind,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late,discount_proposal_id)
      VALUES(${scope.company},${lineId},${scope.business},${sessionId},${scope.service},1,0,'ACTIVE',1,1.000,1.000,0.000,1.000,0,
        'OWNER',NULL,'Synthetic service',1,'ZERO',true,false,${decider.userId},${decider.membershipId},${context.at},false,${proposalId})`;
    await tx`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,
      not_clocked_in_warning,approved_leave_warning)
      VALUES(${scope.company},${context.ids.newId()},${scope.business},${lineId},${employeeId},1,10000,'Synthetic performer',false,false)`;
    await tx`UPDATE discount_proposals SET status='CONSUMED',consumed_line_id=${lineId},consumed_at=${context.at}
      WHERE company_id=${scope.company} AND id=${proposalId}`;
  });
}

async function storeEvent(
  context: DiscountApprovalContext,
  companyId: string,
  aggregateId: string,
  payload: unknown,
): Promise<ClaimedEvent> {
  const id = context.ids.newId();
  await context.db.withTenant(companyId, (tx) =>
    appendOutboxEvent(tx, id, {
      aggregateType: 'discount_proposal',
      aggregateId,
      eventType: 'DiscountApprovedByPerformer',
      payload,
    }),
  );
  return {
    companyId,
    id,
    aggregateType: 'discount_proposal',
    aggregateId,
    eventType: 'DiscountApprovedByPerformer',
    payload,
    attempt: 1,
  };
}
