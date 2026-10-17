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
import { cancelServiceLine } from '../../../../../../packages/db/test/service-line-cancellation.ts';

export const LINE_NET = '1.000';
const REASON = 'customer left unhappy';
const CANCELLER = 'Canceller Identity';

export interface LineCancelContext {
  owner: postgres.Sql;
  db: Database;
  ids: IdGenerator;
  at: Date;
}
export interface CancelSpec {
  company?: string;
  sessionId?: string;
  lineId?: string;
  ordinal?: number;
  branchId?: string;
  change?: 'absent' | 'price' | 'performers' | 'malformed';
  eventRevision?: number;
  eventNet?: string;
  eventPreviousNet?: string;
  cancel?: boolean;
  lineNameEn?: string;
  lineNameAr?: string | null;
}
export interface PreparedCancel {
  companyId: string;
  sessionId: string;
  lineId: string;
  businessId: string;
  branchId: string;
  businessDate: string;
  revision: number;
  net: string;
  event: ClaimedEvent;
}
export function lineCancelData(context: LineCancelContext) {
  return {
    cancel: (spec: CancelSpec = {}) => prepareCancel(context, spec),
    anotherEvent: (prepared: PreparedCancel) => insertCopy(context, prepared),
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
async function prepareCancel(
  context: LineCancelContext,
  spec: CancelSpec,
): Promise<PreparedCancel> {
  const companyId = spec.company ?? TENANT.A.company;
  const line = await insertLine(context, spec, companyId);
  if (spec.lineNameEn !== undefined || spec.lineNameAr !== undefined)
    await context.owner`UPDATE service_lines SET name_en=${spec.lineNameEn ?? 'Synthetic service'}, name_ar=${spec.lineNameAr ?? null}
      WHERE company_id=${companyId} AND id=${line.lineId}`;
  if (spec.cancel !== false) await cancelLine(context, line);
  const revision = spec.eventRevision ?? 2;
  const event = await insertEvent(context, spec, line, revision);
  return { ...line, revision, net: spec.eventNet ?? LINE_NET, event };
}
async function insertLine({ owner, ids }: LineCancelContext, spec: CancelSpec, companyId: string) {
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
        to_jsonb(l)||jsonb_build_object('id',${lineId}::text,'session_id',${sessionId}::text,'ordinal',${ordinal}::int,'input_index',${ordinal - 1}::int,'revision',1,'status','ACTIVE'))).*
        FROM service_lines l WHERE company_id=${companyId} AND id=${ORDER_IDS.line}`;
      await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,
        to_jsonb(p)||jsonb_build_object('id',${ids.newId()}::text,'line_id',${lineId}::text))).*
        FROM line_performers p WHERE company_id=${companyId} AND id=${ORDER_IDS.performer}`;
    }
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
async function cancelLine(
  { db, ids }: LineCancelContext,
  line: Awaited<ReturnType<typeof insertLine>>,
) {
  await db.withTenant(line.companyId, (tx) =>
    cancelServiceLine(tx, {
      companyId: line.companyId,
      lineId: line.lineId,
      expectedRevision: 1,
      cancelledBy: USER,
      membershipId: ORDER_IDS.membership,
      cancellationId: ids.newId(),
      reason: REASON,
      cancellerNameEn: CANCELLER,
    }),
  );
}
async function insertEvent(
  context: LineCancelContext,
  spec: CancelSpec,
  line: Awaited<ReturnType<typeof insertLine>>,
  revision: number,
): Promise<ClaimedEvent> {
  const payload =
    spec.change === 'malformed' ? { broken: true } : linePayload(context, spec, line, revision);
  if (spec.change === undefined) serviceLineChanged.parse(payload);
  return storeEvent(context, line.companyId, line.sessionId, payload);
}
async function insertCopy(
  context: LineCancelContext,
  prepared: PreparedCancel,
): Promise<ClaimedEvent> {
  return storeEvent(
    context,
    prepared.companyId,
    prepared.sessionId,
    structuredClone(prepared.event.payload),
  );
}
async function storeEvent(
  context: LineCancelContext,
  companyId: string,
  sessionId: string,
  payload: unknown,
): Promise<ClaimedEvent> {
  const id = context.ids.newId();
  await context.db.withTenant(companyId, (tx) =>
    appendOutboxEvent(tx, id, {
      aggregateType: 'service_session',
      aggregateId: sessionId,
      eventType: 'ServiceLineChanged',
      payload,
    }),
  );
  return {
    companyId,
    id,
    aggregateType: 'service_session',
    aggregateId: sessionId,
    eventType: 'ServiceLineChanged',
    payload,
    attempt: 1,
  };
}
function linePayload(
  { at }: LineCancelContext,
  spec: CancelSpec,
  line: Awaited<ReturnType<typeof insertLine>>,
  revision: number,
) {
  const net = spec.eventNet ?? LINE_NET;
  const previousNet = spec.eventPreviousNet ?? net;
  const saved = line.saved;
  return {
    line_id: line.lineId,
    session_id: line.sessionId,
    service_id: ORDER_IDS.service,
    branch_id: spec.branchId ?? line.branchId,
    business_id: line.businessId,
    customer_id: saved.customer_id,
    status: 'CANCELLED',
    occurred_at: saved.occurred_at.toISOString(),
    recorded_at: saved.recorded_at.toISOString(),
    business_date: line.businessDate,
    late: false,
    recorded_by: USER,
    recorded_by_membership_id: ORDER_IDS.membership,
    list_price: net,
    price: net,
    discount: '0.000',
    net,
    performers: [{ employee_id: ORDER_IDS.employee, share_bps: 10000 }],
    rule_snapshot: { kind: 'ZERO' },
    counts_snapshot: true,
    package: null,
    revision,
    ...(spec.change === 'absent'
      ? {}
      : {
          change: {
            kind:
              spec.change === 'price'
                ? 'PRICE_DISCOUNT_EDIT'
                : spec.change === 'performers'
                  ? 'PERFORMERS_CHANGE'
                  : 'LINE_CANCELLED',
            ...(spec.change === undefined
              ? {
                  changed_at: at.toISOString(),
                  changed_by: USER,
                  changed_by_membership_id: ORDER_IDS.membership,
                  previous: {
                    revision: revision - 1,
                    price: net,
                    discount: '0.000',
                    net: previousNet,
                  },
                }
              : {}),
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
async function addUser({ owner, ids }: LineCancelContext) {
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
async function addMember({ owner, ids }: LineCancelContext, input: MemberInput) {
  const id = ids.newId();
  const canonical = SYSTEM_ROLES.find((role) => role.code === input.role);
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${input.company},${id},${input.userId},${canonical?.id ?? input.role},${canonical ? 'global' : input.company},
      ${input.scope},${input.scopeId},${input.starts},${input.ends})`;
  return id;
}
