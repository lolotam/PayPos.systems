import type postgres from 'postgres';
import {
  appendOutboxEvent,
  PROVISIONAL_PLAN_ID,
  SYSTEM_ROLES,
  type ClaimedEvent,
  type Database,
  type IdGenerator,
} from '@pospay/db';
import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';

/** حقيقة معلنة تكسر مطابقة المصدر؛ «bps» و«flag» يغطيهما مفتاحا announcedBps/storedBps وperformer. */
export type SelfApprovalMismatch = 'service' | 'decider' | 'via' | 'count' | 'branch';

/** نطاق معزول للاختبار: شركة ونشاط وفرع وخدمة وعميل، حتى لا يسرّب عضو من حالة إلى أخرى. */
export interface SelfApprovalScope {
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  readonly service: string;
  readonly customer: string;
}

/** سياق تجهيز قرار الموافقة الذاتية: اتصال المالك للتجهيز، ومعمل التطبيق للمعاملات. */
export interface SelfApprovalContext {
  owner: postgres.Sql;
  db: Database;
  ids: IdGenerator;
  at: Date;
}

/** الموافِق وعضويته؛ القرار يُنسب لعضوية واحدة، فالفهرسة مركبة عليهما. */
export interface SelfApprovalDecider {
  readonly userId: string;
  readonly membershipId: string;
}

/** شكل القرار المزروع: عدد المقترحات المعلن والمخزّن، وأعلى نسبة، وشكل الحدث. */
export interface DecisionSpec {
  readonly scope?: SelfApprovalScope;
  readonly proposals?: number;
  readonly storedProposals?: number;
  readonly announcedBps?: number;
  readonly storedBps?: number;
  readonly decider?: SelfApprovalDecider;
  readonly decidedVia?: 'PIN' | 'REMOTE';
  readonly performer?: boolean;
  readonly approve?: boolean;
  readonly consume?: boolean;
  readonly malformed?: boolean;
  readonly mismatch?: readonly SelfApprovalMismatch[];
  readonly aggregate?: string;
}

/** القرار المزروع مع حدثه، كما يراه المستهلك. */
export interface PreparedDecision {
  readonly event: ClaimedEvent;
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly decidedBy: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly proposalIds: readonly string[];
  readonly maxEffectiveBps: number;
}

interface StoredProposal {
  readonly id: string;
  readonly serviceId: string;
  readonly effectiveBps: number;
}

export function discountSelfApprovalData(context: SelfApprovalContext) {
  const requesterCache = new Map<string, SelfApprovalDecider>();
  const deciderCache = new Map<string, SelfApprovalDecider>();
  return {
    decision: (spec: DecisionSpec = {}) => prepareDecision(context, spec, requesterCache),
    again: (prepared: PreparedDecision) =>
      storeEvent(
        context,
        prepared.companyId,
        prepared.aggregateType,
        prepared.aggregateId,
        prepared.event.payload,
      ),
    user: () => addUser(context),
    member: (
      userId: string,
      role: string,
      scope = 'COMPANY',
      scopeId: string = TENANT.A.company,
      starts: Date = new Date(context.at.getTime() - 60_000),
      ends: Date | null = null,
      company: string = scope === 'COMPANY' ? scopeId : TENANT.A.company,
    ) => addMember(context, { userId, role, scope, scopeId, starts, ends, company }),
    requesterOf: (company: string) =>
      seededOrSynthetic(context, requesterCache, company, 'cashier'),
    deciderOf: (company: string) => seededOrSynthetic(context, deciderCache, company, 'cashier'),
    otherScope: (company: string = TENANT.A.company) => addScope(context, company),
    otherCompany: () => addCompany(context),
  };
}

/** بذرة A وB ليها عضوية USER الجاهزة؛ غيرها تستعير مستخدمًا بعضوية في شركته حتى لا تنتهك مفاتيح العضوية. */
async function seededOrSynthetic(
  context: SelfApprovalContext,
  cache: Map<string, SelfApprovalDecider>,
  company: string,
  role: string,
): Promise<SelfApprovalDecider> {
  if (company === TENANT.A.company || company === TENANT.B.company)
    return { userId: USER, membershipId: ORDER_IDS.membership };
  const cached = cache.get(company);
  if (cached !== undefined) return cached;
  const userId = await addUser(context);
  const membershipId = await addMember(context, {
    userId,
    role,
    scope: 'COMPANY',
    scopeId: company,
    starts: new Date(context.at.getTime() - 60_000),
    ends: null,
    company,
  });
  const decider = { userId, membershipId };
  cache.set(company, decider);
  return decider;
}

async function prepareDecision(
  context: SelfApprovalContext,
  spec: DecisionSpec,
  requesterCache: Map<string, SelfApprovalDecider>,
): Promise<PreparedDecision> {
  const scope = spec.scope ?? defaultScope();
  const count = spec.proposals ?? 1;
  const storedCount = spec.storedProposals ?? count;
  const announcedBps = spec.announcedBps ?? 2500;
  const storedBps = spec.storedBps ?? announcedBps;
  const requester = await seededOrSynthetic(context, requesterCache, scope.company, 'cashier');
  const decider =
    spec.decider ?? (await seededOrSynthetic(context, requesterCache, scope.company, 'cashier'));
  const decidedVia = spec.decidedVia ?? 'REMOTE';
  const mismatch = new Set(spec.mismatch ?? []);
  const requestId = context.ids.newId();
  const stored: StoredProposal[] = [];
  for (let index = 0; index < storedCount; index += 1)
    stored.push(
      await insertProposal(context, {
        scope,
        requestId,
        index,
        bps: index === 0 ? storedBps : 1000,
        requester,
      }),
    );
  // 0166: القرار تحديث بالأعمدة المسموحة فقط، والـ expires_at تُكتب عند الطلب ولا تُمسّ أبدًا.
  if (spec.approve !== false)
    for (const proposal of stored)
      await decideProposal(context, scope, proposal, decider, decidedVia, spec.performer !== false);
  if (spec.consume === true) await consumeProposal(context, scope, stored[0]);
  const payload = spec.malformed
    ? { broken: true }
    : eventPayload(context, {
        scope,
        stored,
        decider,
        announcedBps,
        count,
        mismatch,
        decidedVia,
      });
  const aggregateType = spec.aggregate ?? 'discount_approval_decision';
  const aggregateId = requestId;
  const event = await storeEvent(context, scope.company, aggregateType, aggregateId, payload);
  return {
    event,
    companyId: scope.company,
    businessId: scope.business,
    branchId: scope.branch,
    decidedBy: decider.userId,
    aggregateType,
    aggregateId,
    proposalIds: stored.map((proposal) => proposal.id),
    maxEffectiveBps: announcedBps,
  };
}

function defaultScope(): SelfApprovalScope {
  return {
    company: TENANT.A.company,
    business: TENANT.A.business,
    branch: TENANT.A.branch,
    service: ORDER_IDS.service,
    customer: ORDER_IDS.customer,
  };
}

function eventPayload(
  context: SelfApprovalContext,
  input: {
    scope: SelfApprovalScope;
    stored: readonly StoredProposal[];
    decider: SelfApprovalDecider;
    announcedBps: number;
    count: number;
    mismatch: ReadonlySet<SelfApprovalMismatch>;
    decidedVia: 'PIN' | 'REMOTE';
  },
) {
  const proposals = input.stored.slice(0, input.count).map((proposal, index) => ({
    id: proposal.id,
    service_id:
      input.mismatch.has('service') && index === 0 ? context.ids.newId() : proposal.serviceId,
    name_en: 'Synthetic service',
    name_ar: null,
    effective_bps: index === 0 ? input.announcedBps : proposal.effectiveBps,
  }));
  // مقترح معلن بلا صف مخزون: عدد الحدث أكبر من العدد المخزون، فالمطابقة ترفض بالعدد exact.
  while (proposals.length < input.count)
    proposals.push({
      id: context.ids.newId(),
      service_id: input.scope.service,
      name_en: 'Synthetic service',
      name_ar: null,
      effective_bps: 1000,
    });
  return {
    schema_version: 1 as const,
    business_id: input.scope.business,
    branch_id: input.mismatch.has('branch') ? context.ids.newId() : input.scope.branch,
    decided_by: input.mismatch.has('decider') ? context.ids.newId() : input.decider.userId,
    decider_label_en: 'Synthetic decider',
    decider_label_ar: 'موافق تجريبي',
    decided_via: input.mismatch.has('via')
      ? input.decidedVia === 'PIN'
        ? 'REMOTE'
        : 'PIN'
      : input.decidedVia,
    proposals,
  };
}

async function insertProposal(
  context: SelfApprovalContext,
  input: {
    scope: SelfApprovalScope;
    requestId: string;
    index: number;
    bps: number;
    requester: SelfApprovalDecider;
  },
): Promise<StoredProposal> {
  const id = context.ids.newId();
  const hash = `${context.ids.newId().replace(/-/g, '')}${context.ids.newId().replace(/-/g, '')}`;
  // الحارس في 0166 يرفض أي إدخال ليس PENDING، فالزرع PENDING ثم التحديث بالأعمدة المسموحة.
  await context.owner`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_role,requester_role_is_system,requester_role_name_en,
    customer_first_name,requested_at,status,expires_at)
    VALUES(${input.scope.company},${id},${input.scope.business},${input.scope.branch},${input.requestId},${input.index},'RECORD',NULL,${context.at},
      ${input.scope.customer},${input.scope.service},'Synthetic service','{}'::jsonb,${hash},${input.bps},${input.requester.userId},${input.requester.membershipId},
      'PERSON',1000,'cashier',true,'Cashier','Synthetic',${context.at},'PENDING',${new Date(context.at.getTime() + 86_400_000)})`;
  return { id, serviceId: input.scope.service, effectiveBps: input.bps };
}

async function decideProposal(
  context: SelfApprovalContext,
  scope: SelfApprovalScope,
  proposal: StoredProposal,
  decider: SelfApprovalDecider,
  decidedVia: 'PIN' | 'REMOTE',
  performer: boolean,
) {
  await context.owner`UPDATE discount_proposals SET status='APPROVED', decided_by=${decider.userId},
    decided_by_membership_id=${decider.membershipId}, decided_via=${decidedVia}, decided_device_id=NULL,
    decider_name_ar=NULL, decider_name_en='Synthetic decider', decider_role='owner', decider_role_is_system=true,
    decider_role_name_en='Owner', decided_at=${context.at}, approved_limit_source='OWNER', approved_limit_bps=NULL,
    approver_is_performer=${performer}
    WHERE company_id=${scope.company} AND id=${proposal.id}`;
}

async function consumeProposal(
  context: SelfApprovalContext,
  scope: SelfApprovalScope,
  proposal: StoredProposal | undefined,
) {
  if (proposal === undefined) throw new Error('a consumed decision needs one stored proposal');
  // زوج FK المؤجل في 0163–0164 يثبت أن السطر والاقتراح يشيران لبعضهما: يُحدَّث الوجهان في معاملة واحدة.
  await context.owner.begin(async (tx) => {
    await tx`UPDATE service_lines SET discount_proposal_id=${proposal.id}
      WHERE company_id=${scope.company} AND id=${ORDER_IDS.line}`;
    await tx`UPDATE discount_proposals SET status='CONSUMED', consumed_line_id=${ORDER_IDS.line}, consumed_at=${context.at}
      WHERE company_id=${scope.company} AND id=${proposal.id}`;
  });
}

async function storeEvent(
  context: SelfApprovalContext,
  companyId: string,
  aggregateType: string,
  aggregateId: string,
  payload: unknown,
): Promise<ClaimedEvent> {
  const id = context.ids.newId();
  await context.db.withTenant(companyId, (tx) =>
    appendOutboxEvent(tx, id, {
      aggregateType,
      aggregateId,
      eventType: 'DiscountApprovedByPerformer',
      payload,
    }),
  );
  return {
    companyId,
    id,
    aggregateType,
    aggregateId,
    eventType: 'DiscountApprovedByPerformer',
    payload,
    attempt: 1,
  };
}

async function addUser({ owner, ids }: SelfApprovalContext) {
  const id = ids.newId();
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES(${id},'Synthetic owner',${`${id}@example.test`},true,now(),now())`;
  return id;
}

interface MemberInput {
  userId: string;
  role: string;
  scope: string;
  scopeId: string;
  starts: Date;
  ends: Date | null;
  company: string;
}

async function addMember({ owner, ids }: SelfApprovalContext, input: MemberInput) {
  const id = ids.newId();
  const canonical = SYSTEM_ROLES.find((role) => role.code === input.role);
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${input.company},${id},${input.userId},${canonical?.id ?? input.role},${canonical ? 'global' : input.company},
      ${input.scope},${input.scopeId},${input.starts},${input.ends})`;
  return id;
}

/** نطاق معزول داخل الشركة: نشاط وفرع وخدمة وعميل جدد، فلا يسرّب عضو من حالة إلى أخرى. */
async function addScope(
  { owner, ids }: SelfApprovalContext,
  company: string,
): Promise<SelfApprovalScope> {
  const business = ids.newId();
  const branch = ids.newId();
  const service = ids.newId();
  const customer = ids.newId();
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${company},${business},'Other salon','salon')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${company},${branch},${business},'Other branch')`;
  await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${company},${service},${business},'Synthetic service',1.000,'ZERO')`;
  await owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${company},${customer},'Synthetic customer',${phoneOf()},'en',now(),now())`;
  return { company, business, branch, service, customer };
}

let phoneSequence = 0; // كل نداء يعطي رقماً مختلفاً، والرقم فريد داخل الشركة.
function phoneOf(): string {
  phoneSequence += 1;
  return `+9${String(phoneSequence).padStart(9, '0')}`;
}

/** شركة معزولة كاملة، فلا يسرّب مالكها إلى غيره. */
async function addCompany({ owner, ids }: SelfApprovalContext): Promise<SelfApprovalScope> {
  const company = ids.newId();
  const business = ids.newId();
  const branch = ids.newId();
  const service = ids.newId();
  const customer = ids.newId();
  await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id)
    VALUES(${company},'Other company',${USER},${PROVISIONAL_PLAN_ID})`;
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${company},${business},'Other salon','salon')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${company},${branch},${business},'Other branch')`;
  await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${company},${service},${business},'Synthetic service',1.000,'ZERO')`;
  await owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${company},${customer},'Synthetic customer',${phoneOf()},'en',now(),now())`;
  return { company, business, branch, service, customer };
}
