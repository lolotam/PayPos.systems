import type postgres from 'postgres';
import {
  appendOutboxEvent,
  SYSTEM_ROLES,
  type Database,
  type IdGenerator,
  type ClaimedEvent,
} from '@pospay/db';
import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
export interface NoticeDataContext {
  owner: postgres.Sql;
  db: Database;
  ids: IdGenerator;
  at: Date;
}
export function noticeData(context: NoticeDataContext) {
  return {
    session: (late = true, company: string = TENANT.A.company) =>
      createSession(context, late, company),
    event: (
      sessionId: string,
      late = true,
      eventType = 'ServiceSessionRecorded',
      company: string = TENANT.A.company,
    ) => createEvent(context, sessionId, late, eventType, company),
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
async function createSession({ owner, ids }: NoticeDataContext, late: boolean, company: string) {
  const sessionId = ids.newId(),
    lineId = ids.newId();
  await owner.begin(async (tx) => {
    await tx`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
      to_jsonb(s)||jsonb_build_object('id',${sessionId}::text,'late',${late}))).* FROM service_sessions s
      WHERE company_id=${company} AND id=${ORDER_IDS.session}`;
    await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
      to_jsonb(l)||jsonb_build_object('id',${lineId}::text,'session_id',${sessionId}::text,'late',${late}))).* FROM service_lines l
      WHERE company_id=${company} AND id=${ORDER_IDS.line}`;
    await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,
      to_jsonb(p)||jsonb_build_object('id',${ids.newId()}::text,'line_id',${lineId}::text))).* FROM line_performers p
      WHERE company_id=${company} AND id=${ORDER_IDS.performer}`;
  });
  return sessionId;
}
async function createEvent(
  { owner, ids, db }: NoticeDataContext,
  sessionId: string,
  late: boolean,
  eventType: string,
  company: string,
): Promise<ClaimedEvent> {
  const [saved] =
    await owner`SELECT *,business_date::text AS saved_date FROM service_sessions WHERE company_id=${company} AND id=${sessionId}`;
  if (!saved) throw new Error('fixture session required');
  const payload = eventPayload(saved, sessionId, late, ids.newId());
  const id = ids.newId();
  await db.withTenant(company, (tx) =>
    appendOutboxEvent(tx, id, {
      aggregateType: 'service_session',
      aggregateId: sessionId,
      eventType,
      payload,
    }),
  );
  return {
    companyId: company,
    id,
    aggregateType: 'service_session',
    aggregateId: sessionId,
    eventType,
    payload,
    attempt: 1,
  };
}
function eventPayload(saved: postgres.Row, sessionId: string, late: boolean, lineId: string) {
  const identity = {
    session_id: sessionId,
    business_id: saved['business_id'],
    branch_id: saved['branch_id'],
    customer_id: saved['customer_id'],
    occurred_at: (saved['occurred_at'] as Date).toISOString(),
    recorded_at: (saved['recorded_at'] as Date).toISOString(),
    business_date: saved['saved_date'],
    late,
    recorded_by: USER,
    recorded_by_membership_id: ORDER_IDS.membership,
  };
  return {
    ...identity,
    schema_version: 1,
    business_timezone: saved['business_timezone'],
    lines: [
      {
        ...identity,
        line_id: lineId,
        service_id: ORDER_IDS.service,
        status: 'ACTIVE',
        list_price: '1.000',
        price: '1.000',
        discount: '0.000',
        net: '1.000',
        performers: [{ employee_id: ORDER_IDS.employee, share_bps: 10000 }],
        rule_snapshot: { kind: 'ZERO' },
        counts_snapshot: true,
        package: null,
        revision: 1,
      },
    ],
  };
}
async function addUser({ owner, ids }: NoticeDataContext) {
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
async function addMember({ owner, ids }: NoticeDataContext, input: MemberInput) {
  const id = ids.newId();
  const canonical = SYSTEM_ROLES.find((r) => r.code === input.role);
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${input.company},${id},${input.userId},${canonical?.id ?? input.role},${canonical ? 'global' : input.company},
      ${input.scope},${input.scopeId},${input.starts},${input.ends})`;
  return id;
}
