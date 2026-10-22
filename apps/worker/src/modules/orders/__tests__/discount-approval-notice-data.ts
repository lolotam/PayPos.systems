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

export const APPROVAL_PERMISSION = 'approve:discounts:branch';

/** نطاق معزول للاختبار: شركة ونشاط وفرع وخدمة، حتى لا يسرّب عضو من حالة إلى أخرى. */
export interface ApprovalScope {
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  readonly service: string;
  readonly customer: string;
}

/** سياق تجهيز طلب الموافقة: اتصال المالك للتجهيز، ومعمل التطبيق للمعاملات. */
export interface DiscountApprovalContext {
  owner: postgres.Sql;
  db: Database;
  ids: IdGenerator;
  at: Date;
}

/** الطالبة وعضويتها؛ الطلب يُنسب لعضوية واحدة، فالفهرسة مركبة عليهما. */
export interface ApprovalRequester {
  readonly userId: string;
  readonly membershipId: string;
}

/** شكل الطلب المزروع: عدد السطور المعلن والمخزّن، وأعلى نسبة، وشكل الحدث. */
export interface RequestSpec {
  readonly scope?: ApprovalScope;
  readonly lines?: number;
  readonly storedLines?: number;
  readonly announcedBps?: number;
  readonly storedBps?: number;
  readonly requester?: ApprovalRequester;
  readonly aggregate?: 'wrongType' | 'wrongId';
  readonly malformed?: boolean;
}

/** الطلب المزروع مع حدثه، كما يراه المستهلك. */
export interface PreparedRequest {
  readonly requestId: string;
  readonly event: ClaimedEvent;
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly requestedBy: string;
  readonly lineCount: number;
  readonly maxEffectiveBps: number;
}

export function discountApprovalData(context: DiscountApprovalContext) {
  return {
    request: (spec: RequestSpec = {}) => prepareRequest(context, spec),
    again: (prepared: PreparedRequest) =>
      storeEvent(
        context,
        prepared.companyId,
        'discount_approval_request',
        prepared.requestId,
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
      company: string = TENANT.A.company,
    ) => addMember(context, { userId, role, scope, scopeId, starts, ends, company }),
    allow: (
      membershipId: string,
      scopeType: string,
      scopeId: string,
      company: string = TENANT.A.company,
    ) => addOverride(context, { membershipId, scopeType, scopeId, company, effect: 'ALLOW' }),
    deny: (
      membershipId: string,
      scopeType: string,
      scopeId: string,
      company: string = TENANT.A.company,
      expiresAt: Date | null = null,
    ) =>
      addOverride(context, {
        membershipId,
        scopeType,
        scopeId,
        company,
        effect: 'DENY',
        expiresAt,
      }),
    otherScope: (company: string = TENANT.A.company) => addScope(context, company),
    otherCompany: () => addCompany(context),
  };
}

async function prepareRequest(
  context: DiscountApprovalContext,
  spec: RequestSpec,
): Promise<PreparedRequest> {
  const scope = spec.scope ?? defaultScope();
  const requestId = context.ids.newId();
  const lines = spec.lines ?? 2;
  const storedLines = spec.storedLines ?? lines;
  const announcedBps = spec.announcedBps ?? 2000;
  const storedBps = spec.storedBps ?? announcedBps;
  const requester = spec.requester ?? { userId: USER, membershipId: ORDER_IDS.membership };
  for (let index = 0; index < storedLines; index += 1)
    await insertProposal(context, {
      scope,
      requestId,
      index,
      bps: index === 0 ? storedBps : 1000,
      requester,
    });
  const payload = spec.malformed
    ? { broken: true }
    : eventPayload(context, { requestId, scope, requester, lines, announcedBps });
  const aggregateType =
    spec.aggregate === 'wrongType' ? 'discount_proposal' : 'discount_approval_request';
  const aggregateId = spec.aggregate === 'wrongId' ? context.ids.newId() : requestId;
  const event = await storeEvent(context, scope.company, aggregateType, aggregateId, payload);
  return {
    requestId,
    event,
    companyId: scope.company,
    businessId: scope.business,
    branchId: scope.branch,
    requestedBy: requester.userId,
    lineCount: lines,
    maxEffectiveBps: announcedBps,
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
  input: {
    requestId: string;
    scope: ApprovalScope;
    requester: ApprovalRequester;
    lines: number;
    announcedBps: number;
  },
) {
  return {
    schema_version: 1 as const,
    request_id: input.requestId,
    business_id: input.scope.business,
    branch_id: input.scope.branch,
    requested_by: input.requester.userId,
    line_count: input.lines,
    max_effective_bps: input.announcedBps,
    services: [{ service_id: input.scope.service, name_en: 'Synthetic service', name_ar: null }],
    occurred_at: context.at.toISOString(),
  };
}

async function insertProposal(
  context: DiscountApprovalContext,
  input: {
    scope: ApprovalScope;
    requestId: string;
    index: number;
    bps: number;
    requester: ApprovalRequester;
  },
) {
  const hash = `${context.ids.newId().replace(/-/g, '')}${context.ids.newId().replace(/-/g, '')}`;
  // الطلب بلا زيارة محفوظة: سطر التسجيل الجديد قد يكون لزيارة لم تُحفظ بعد (DP-02).
  await context.owner`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_role,requester_role_is_system,requester_role_name_en,
    customer_first_name,requested_at,status,expires_at)
    VALUES(${input.scope.company},${context.ids.newId()},${input.scope.business},${input.scope.branch},${input.requestId},${input.index},'RECORD',NULL,${context.at},
      ${input.scope.customer},${input.scope.service},'Synthetic service','{}'::jsonb,${hash},${input.bps},${input.requester.userId},${input.requester.membershipId},
      'PERSON',1000,'cashier',true,'Cashier','Synthetic',${context.at},'PENDING',${new Date(context.at.getTime() + 86_400_000)})`;
}

async function storeEvent(
  context: DiscountApprovalContext,
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
      eventType: 'DiscountApprovalRequested',
      payload,
    }),
  );
  return {
    companyId,
    id,
    aggregateType,
    aggregateId,
    eventType: 'DiscountApprovalRequested',
    payload,
    attempt: 1,
  };
}

async function addUser({ owner, ids }: DiscountApprovalContext) {
  const id = ids.newId();
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES(${id},'Synthetic approver',${`${id}@example.test`},true,now(),now())`;
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

async function addMember({ owner, ids }: DiscountApprovalContext, input: MemberInput) {
  const id = ids.newId();
  const canonical = SYSTEM_ROLES.find((role) => role.code === input.role);
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${input.company},${id},${input.userId},${canonical?.id ?? input.role},${canonical ? 'global' : input.company},
      ${input.scope},${input.scopeId},${input.starts},${input.ends})`;
  return id;
}

interface OverrideInput {
  membershipId: string;
  scopeType: string;
  scopeId: string;
  company: string;
  effect: 'ALLOW' | 'DENY';
  expiresAt?: Date | null;
}

async function addOverride({ owner, ids }: DiscountApprovalContext, input: OverrideInput) {
  const id = ids.newId();
  await owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by,expires_at)
    VALUES(${input.company},${id},${input.membershipId},${APPROVAL_PERMISSION},${input.effect},${input.scopeType},${input.scopeId},'Synthetic override',${USER},${input.expiresAt ?? null})`;
  return id;
}

/** نطاق معزول داخل الشركة: نشاط وفرع وخدمة وعميل جدد، فلا يسرّب عضو من حالة إلى أخرى. */
async function addScope(
  { owner, ids }: DiscountApprovalContext,
  company: string,
): Promise<ApprovalScope> {
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
async function addCompany({ owner, ids }: DiscountApprovalContext): Promise<ApprovalScope> {
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
