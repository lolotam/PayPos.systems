import type postgres from 'postgres';
import {
  appendOutboxEvent,
  SYSTEM_ROLES,
  type ClaimedEvent,
  type Database,
  type IdGenerator,
} from '@pospay/db';
import { serviceLineChanged } from '@pospay/contracts';
import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';

export interface PriceEditContext {
  owner: postgres.Sql;
  db: Database;
  ids: IdGenerator;
  at: Date;
}
export interface EditSpec {
  revision?: number;
  lineRevision?: number;
  previousNet?: string;
  newNet?: string;
  eventPreviousNet?: string;
  eventNewNet?: string;
  editorNameAr?: string | null;
  editorNameEn?: string | null;
  editorRole?: string | null;
  editorRoleIsSystem?: boolean;
  editorRoleNameAr?: string | null;
  editorRoleNameEn?: string;
  company?: string;
  sessionId?: string;
  lineId?: string;
  ordinal?: number;
  history?: boolean;
  change?: 'price' | 'absent' | 'other' | 'malformed';
  branchId?: string;
}
export interface PreparedEdit {
  companyId: string;
  sessionId: string;
  lineId: string;
  businessId: string;
  branchId: string;
  businessDate: string;
  revision: number;
  event: ClaimedEvent;
}
export function priceEditData(context: PriceEditContext) {
  return {
    edit: (spec: EditSpec = {}) => prepareEdit(context, spec),
    user: () => addUser(context),
    member: (
      userId: string,
      role: string,
      scope = 'COMPANY',
      scopeId: string = TENANT.A.company,
      starts = new Date(context.at.getTime() - 60_000),
      ends: Date | null = null,
      company: string = TENANT.A.company,
    ) => addMember(context, { userId, role, scope, scopeId, starts, ends, company }),
  };
}
async function prepareEdit(context: PriceEditContext, spec: EditSpec): Promise<PreparedEdit> {
  const companyId = spec.company ?? TENANT.A.company;
  const revision = spec.revision ?? 2;
  const line = await insertLine(context, spec, companyId, spec.lineRevision ?? revision);
  if (spec.history !== false && spec.change !== 'malformed')
    await insertHistory(context, spec, line, revision);
  const event = await insertEvent(context, spec, line, revision);
  return { ...line, revision, event };
}
async function insertLine(
  { owner, ids }: PriceEditContext,
  spec: EditSpec,
  companyId: string,
  lineRevision: number,
) {
  if (spec.lineId !== undefined && spec.sessionId === undefined)
    throw new Error('fixture line requires its session');
  const sessionId = spec.sessionId ?? ids.newId();
  const lineId = spec.lineId ?? ids.newId();
  const ordinal = spec.ordinal ?? 1;
  await owner.begin(async (tx) => {
    if (spec.sessionId === undefined)
      await tx`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
        to_jsonb(s)||jsonb_build_object('id',${sessionId}::text))).* FROM service_sessions s
        WHERE company_id=${companyId} AND id=${ORDER_IDS.session}`;
    if (spec.lineId === undefined) {
      await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
        to_jsonb(l)||jsonb_build_object('id',${lineId}::text,'session_id',${sessionId}::text,'ordinal',${ordinal}::int,'revision',${lineRevision}::int))).*
        FROM service_lines l WHERE company_id=${companyId} AND id=${ORDER_IDS.line}`;
      await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,
        to_jsonb(p)||jsonb_build_object('id',${ids.newId()}::text,'line_id',${lineId}::text))).*
        FROM line_performers p WHERE company_id=${companyId} AND id=${ORDER_IDS.performer}`;
    } else
      await tx`UPDATE service_lines SET revision=${lineRevision} WHERE company_id=${companyId} AND id=${lineId}`;
  });
  const [saved] = await owner<
    SavedSession[]
  >`SELECT business_id,branch_id,customer_id,business_timezone,
    business_date::text AS saved_date,occurred_at,recorded_at
    FROM service_sessions WHERE company_id=${companyId} AND id=${sessionId}`;
  if (!saved) throw new Error('fixture session required');
  return {
    companyId,
    sessionId,
    lineId,
    businessId: saved.business_id,
    branchId: saved.branch_id,
    businessDate: saved.saved_date,
    saved,
  };
}
async function insertHistory(
  { owner, ids, at }: PriceEditContext,
  spec: EditSpec,
  line: Awaited<ReturnType<typeof insertLine>>,
  revision: number,
) {
  const previousNet = spec.previousNet ?? '2.500';
  const newNet = spec.newNet ?? '1250.000';
  const role = spec.editorRole === undefined ? 'owner' : spec.editorRole;
  const nameEn = spec.editorNameEn === undefined ? 'Synthetic editor' : spec.editorNameEn;
  const insert = (
    query: postgres.TransactionSql,
  ) => query`INSERT INTO service_line_edits(company_id,id,business_id,line_id,revision,previous_revision,
    previous_price,previous_discount,previous_net,new_price,new_discount,new_net,
    previous_effective_discount_bps,previous_limit_source,new_effective_discount_bps,new_limit_source,
    reason,changed_at,changed_by,changed_by_membership_id,editor_name_ar,editor_name_en,editor_role,
    editor_role_is_system,editor_role_name_ar,editor_role_name_en)
    VALUES(${line.companyId},${ids.newId()},${line.businessId},${line.lineId},${revision},${revision - 1},
      ${previousNet},'0.000',${previousNet},${newNet},'0.000',${newNet},
      0,'OWNER',0,'OWNER','recorded reason',${at},${USER},${ORDER_IDS.membership},
      ${spec.editorNameAr === undefined ? null : spec.editorNameAr},${nameEn},${role},
      ${role === null ? null : (spec.editorRoleIsSystem ?? true)},${spec.editorRoleNameAr ?? null},
      ${role === null ? null : (spec.editorRoleNameEn ?? 'Synthetic role')})`;
  // صف بلا اسم ولا دور لم يعد ممكناً بعد 35d-3b؛ نكتبه بإسقاط القيد لحظياً لنختبر دفاع المستهلك أمام صف تاريخي قديم.
  const legacyShape = role === null && nameEn === null;
  await owner.begin(async (tx) => {
    if (legacyShape)
      await tx`ALTER TABLE service_line_edits DROP CONSTRAINT service_line_edits_editor_identity`;
    await insert(tx);
    if (legacyShape)
      await tx`ALTER TABLE service_line_edits ADD CONSTRAINT service_line_edits_editor_identity
        CHECK (editor_name_en IS NOT NULL OR editor_role IS NOT NULL) NOT VALID`;
  });
}
async function insertEvent(
  context: PriceEditContext,
  spec: EditSpec,
  line: Awaited<ReturnType<typeof insertLine>>,
  revision: number,
): Promise<ClaimedEvent> {
  const payload =
    spec.change === 'malformed' ? { broken: true } : linePayload(context, spec, line, revision);
  if (spec.change === undefined || spec.change === 'price') serviceLineChanged.parse(payload);
  const id = context.ids.newId();
  await context.db.withTenant(line.companyId, (tx) =>
    appendOutboxEvent(tx, id, {
      aggregateType: 'service_session',
      aggregateId: line.sessionId,
      eventType: 'ServiceLineChanged',
      payload,
    }),
  );
  return {
    companyId: line.companyId,
    id,
    aggregateType: 'service_session',
    aggregateId: line.sessionId,
    eventType: 'ServiceLineChanged',
    payload,
    attempt: 1,
  };
}
function linePayload(
  { at }: PriceEditContext,
  spec: EditSpec,
  line: Awaited<ReturnType<typeof insertLine>>,
  revision: number,
) {
  const previousNet = spec.eventPreviousNet ?? spec.previousNet ?? '2.500';
  const newNet = spec.eventNewNet ?? spec.newNet ?? '1250.000';
  const saved = line.saved;
  return {
    line_id: line.lineId,
    session_id: line.sessionId,
    service_id: ORDER_IDS.service,
    branch_id: spec.branchId ?? line.branchId,
    business_id: line.businessId,
    customer_id: saved.customer_id,
    status: 'ACTIVE',
    occurred_at: saved.occurred_at.toISOString(),
    recorded_at: saved.recorded_at.toISOString(),
    business_date: line.businessDate,
    late: false,
    recorded_by: USER,
    recorded_by_membership_id: ORDER_IDS.membership,
    list_price: newNet,
    price: newNet,
    discount: '0.000',
    net: newNet,
    performers: [{ employee_id: ORDER_IDS.employee, share_bps: 10000 }],
    rule_snapshot: { kind: 'ZERO' },
    counts_snapshot: true,
    package: null,
    revision,
    ...(spec.change === 'absent'
      ? {}
      : {
          change: {
            kind: spec.change === 'other' ? 'OTHER' : 'PRICE_DISCOUNT_EDIT',
            changed_at: at.toISOString(),
            changed_by: USER,
            changed_by_membership_id: ORDER_IDS.membership,
            previous: {
              revision: revision - 1,
              price: previousNet,
              discount: '0.000',
              net: previousNet,
            },
          },
        }),
  };
}
interface SavedSession {
  business_id: string;
  branch_id: string;
  customer_id: string;
  business_timezone: string;
  saved_date: string;
  occurred_at: Date;
  recorded_at: Date;
}
async function addUser({ owner, ids }: PriceEditContext) {
  const id = ids.newId();
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES(${id},'Synthetic manager',${`${id}@example.test`},true,now(),now())`;
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
async function addMember({ owner, ids }: PriceEditContext, input: MemberInput) {
  const id = ids.newId();
  const canonical = SYSTEM_ROLES.find((role) => role.code === input.role);
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${input.company},${id},${input.userId},${canonical?.id ?? input.role},${canonical ? 'global' : input.company},
      ${input.scope},${input.scopeId},${input.starts},${input.ends})`;
  return id;
}
