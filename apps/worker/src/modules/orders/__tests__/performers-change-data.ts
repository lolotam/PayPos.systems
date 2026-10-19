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
import {
  commitChange,
  performer,
  recordLine,
  type ChangeCtx,
  type Person,
} from '../../../../../../packages/db/test/service-line-performer-change.ts';

export const LINE_NET = '1.000';
export const PERFORMERS_REASON = 'wrong split recorded';
export const PERFORMERS_CHANGER = 'Changer Identity';
export const PERFORMER_NAME = 'Synthetic performer';
const OTHER_EMPLOYEE = '01920000-0000-7000-8000-000000004499';
let nextOrdinal = 2;

export interface PerformersChangeContext {
  owner: postgres.Sql;
  db: Database;
  ids: IdGenerator;
  at: Date;
}
export interface ChangeSpec {
  company?: string;
  kind?: 'performers' | 'price' | 'cancel' | 'absent' | 'malformed';
  mismatch?: 'after-employee' | 'before-employee';
  branchId?: string;
  businessDate?: string;
  eventNet?: string;
  line?: LineState;
  again?: boolean;
  missingHeader?: boolean;
}
export interface LineState {
  companyId: string;
  sessionId: string;
  lineId: string;
  businessId: string;
  branchId: string;
  businessDate: string;
  revision: number;
  person: Person;
  saved: SavedSession;
}
export interface PreparedChange extends LineState {
  net: string;
  event: ClaimedEvent;
}
export function performersChangeData(context: PerformersChangeContext) {
  return {
    change: (spec: ChangeSpec = {}) => prepareChange(context, spec),
    anotherEvent: (prepared: PreparedChange) =>
      storeEvent(context, prepared.companyId, prepared.sessionId, structuredClone(prepared.event.payload)),
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
async function prepareChange(
  context: PerformersChangeContext,
  spec: ChangeSpec,
): Promise<PreparedChange> {
  const ctx = companyCtx(spec.line?.companyId ?? spec.company);
  const line = spec.line ?? (await recordFresh(context, ctx));
  const moved = await moveLine(context, ctx, line, spec);
  const net = spec.eventNet ?? LINE_NET;
  return { ...moved, net, event: await insertEvent(context, spec, moved, net) };
}
async function recordFresh(context: PerformersChangeContext, ctx: ChangeCtx): Promise<LineState> {
  const lineId = context.ids.newId();
  const ordinal = nextOrdinal;
  nextOrdinal += 1;
  const person = performer(ORDER_IDS.employee, { nameEn: PERFORMER_NAME });
  await recordLine(context.db, ctx, context.ids, lineId, ordinal, [person]);
  const saved = await readSession(context.owner, ctx);
  return {
    companyId: ctx.company,
    sessionId: ctx.sessionId,
    lineId,
    businessId: saved.business_id,
    branchId: saved.branch_id,
    businessDate: saved.saved_date,
    revision: 1,
    person,
    saved,
  };
}
async function moveLine(
  context: PerformersChangeContext,
  ctx: ChangeCtx,
  line: LineState,
  spec: ChangeSpec,
): Promise<LineState> {
  if (spec.again === true) return commitRecorded(context, ctx, line, line.revision, line.revision + 1);
  if (spec.missingHeader === true) return cancelRecorded(context, ctx, line);
  if (spec.kind !== undefined && spec.kind !== 'performers') return line;
  return commitRecorded(context, ctx, line, 1, 2);
}
async function commitRecorded(
  context: PerformersChangeContext,
  ctx: ChangeCtx,
  line: LineState,
  previous: number,
  revision: number,
): Promise<LineState> {
  await commitChange(context.db, ctx, context.ids, {
    lineId: line.lineId,
    previous,
    revision,
    before: [line.person],
    after: [line.person],
    live: [line.person],
    reason: PERFORMERS_REASON,
    changerNameEn: PERFORMERS_CHANGER,
  });
  return { ...line, revision };
}
async function cancelRecorded(
  context: PerformersChangeContext,
  ctx: ChangeCtx,
  line: LineState,
): Promise<LineState> {
  await context.db.withTenant(ctx.company, (tx) =>
    cancelServiceLine(tx, {
      companyId: ctx.company,
      lineId: line.lineId,
      expectedRevision: 1,
      cancelledBy: USER,
      membershipId: ORDER_IDS.membership,
      cancellationId: context.ids.newId(),
      reason: PERFORMERS_REASON,
      cancellerNameEn: PERFORMERS_CHANGER,
    }),
  );
  return { ...line, revision: 2 };
}
async function insertEvent(
  context: PerformersChangeContext,
  spec: ChangeSpec,
  line: LineState,
  net: string,
): Promise<ClaimedEvent> {
  const payload = linePayload(context, spec, line, net);
  if (spec.kind !== 'malformed') serviceLineChanged.parse(payload);
  return storeEvent(context, line.companyId, line.sessionId, payload);
}
function linePayload(
  context: PerformersChangeContext,
  spec: ChangeSpec,
  line: LineState,
  net: string,
) {
  if (spec.kind === 'malformed') return { broken: true };
  const revision = eventRevision(spec, line);
  return {
    ...identity(spec, line),
    ...amounts(net),
    status: spec.kind === 'cancel' ? 'CANCELLED' : 'ACTIVE',
    revision,
    performers: announced(spec, line, 'after'),
    ...changeOf(context, spec, line, net, revision),
  };
}
function eventRevision(spec: ChangeSpec, line: LineState): number {
  if (spec.kind === 'absent') return 1;
  if (spec.kind === 'price' || spec.kind === 'cancel') return 2;
  return line.revision;
}
function changeOf(
  context: PerformersChangeContext,
  spec: ChangeSpec,
  line: LineState,
  net: string,
  revision: number,
) {
  if (spec.kind === 'absent') return {};
  const previous = { revision: revision - 1 };
  if (spec.kind === 'price' || spec.kind === 'cancel') {
    return {
      change: {
        kind: spec.kind === 'price' ? 'PRICE_DISCOUNT_EDIT' : 'LINE_CANCELLED',
        ...actor(context),
        previous: { ...previous, price: net, discount: '0.000', net },
      },
    };
  }
  return {
    change: {
      kind: 'PERFORMERS_CHANGE' as const,
      ...actor(context),
      previous: { ...previous, performers: announced(spec, line, 'before') },
    },
  };
}
function announced(spec: ChangeSpec, line: LineState, side: 'before' | 'after') {
  const real = [{ employee_id: line.person.employeeId, share_bps: line.person.share }];
  const other = [{ employee_id: OTHER_EMPLOYEE, share_bps: line.person.share }];
  if (side === 'after' && spec.mismatch === 'after-employee') return other;
  if (side === 'before' && spec.mismatch === 'before-employee') return other;
  return real;
}
function identity(spec: ChangeSpec, line: LineState) {
  const saved = line.saved;
  return {
    line_id: line.lineId,
    session_id: line.sessionId,
    service_id: ORDER_IDS.service,
    branch_id: spec.branchId ?? line.branchId,
    business_id: line.businessId,
    customer_id: saved.customer_id,
    occurred_at: saved.occurred_at.toISOString(),
    recorded_at: saved.recorded_at.toISOString(),
    business_date: spec.businessDate ?? line.businessDate,
    late: false,
    recorded_by: USER,
    recorded_by_membership_id: ORDER_IDS.membership,
    rule_snapshot: { kind: 'ZERO' as const },
    counts_snapshot: true,
    package: null,
  };
}
function amounts(net: string) {
  return { list_price: net, price: net, discount: '0.000', net };
}
function actor(context: PerformersChangeContext) {
  return {
    changed_at: context.at.toISOString(),
    changed_by: USER,
    changed_by_membership_id: ORDER_IDS.membership,
  };
}
function companyCtx(company: string = TENANT.A.company): ChangeCtx {
  const tenant = company === TENANT.B.company ? TENANT.B : TENANT.A;
  return {
    company: tenant.company,
    business: tenant.business,
    branch: tenant.branch,
    userId: USER,
    membershipId: ORDER_IDS.membership,
    sessionId: ORDER_IDS.session,
    serviceId: ORDER_IDS.service,
  };
}
async function readSession(owner: postgres.Sql, ctx: ChangeCtx): Promise<SavedSession> {
  const [saved] = await owner<SavedSession[]>`SELECT business_id, branch_id, customer_id, business_timezone,
    business_date::text AS saved_date, occurred_at, recorded_at
    FROM service_sessions WHERE company_id=${ctx.company} AND id=${ctx.sessionId}`;
  if (!saved) throw new Error('fixture session required');
  return saved;
}
async function storeEvent(
  context: PerformersChangeContext,
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
interface SavedSession {
  business_id: string;
  branch_id: string;
  customer_id: string;
  business_timezone: string;
  saved_date: string;
  occurred_at: Date;
  recorded_at: Date;
}
async function addUser({ owner, ids }: PerformersChangeContext) {
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
async function addMember({ owner, ids }: PerformersChangeContext, input: MemberInput) {
  const id = ids.newId();
  const canonical = SYSTEM_ROLES.find((role) => role.code === input.role);
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${input.company},${id},${input.userId},${canonical?.id ?? input.role},${canonical ? 'global' : input.company},
      ${input.scope},${input.scopeId},${input.starts},${input.ends})`;
  return id;
}
