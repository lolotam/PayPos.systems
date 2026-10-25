import type postgres from 'postgres';
import { appendOutboxEvent, type ClaimedEvent, type Database, type IdGenerator } from '@pospay/db';
import { TENANT, USER } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS } from '../../../../../packages/db/test/orders-fixture.ts';
import { cancelServiceLine } from '../../../../../packages/db/test/service-line-cancellation.ts';
import { localParts } from '../../modules/customers/domain/zoned-time.ts';
import type { OpeningHoursValue } from '../../modules/customers/domain/opening-hours.ts';

export type RatingEventType =
  'ServiceSessionRecorded' | 'ServiceSessionLinesAdded' | 'ServiceLineChanged';

export interface BranchOptions {
  timezone?: string | null;
  openingHours?: OpeningHoursValue | null;
}

export interface SessionOptions {
  occurredAt: Date;
  recordedAt?: Date;
  customerId?: string;
  branchId?: string;
  businessId?: string;
  company?: string;
}

export interface SchedulingDataContext {
  owner: postgres.Sql;
  db: Database;
  ids: IdGenerator;
}

/** مواعيد كل أيام الأسبوع، عشان يوم الاختبار ما يتبعش يوم الأسبوع. */
export function everyDay(
  intervals: readonly { opens: string; closes: string }[],
): OpeningHoursValue {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, intervals }));
}

export function schedulingData(context: SchedulingDataContext) {
  return {
    branch: (options: BranchOptions = {}) => branch(context, options),
    setHours: (branchId: string, openingHours: OpeningHoursValue | null, timezone: string | null) =>
      setHours(context.owner, branchId, openingHours, timezone),
    customer: () => customer(context.owner, context.ids),
    session: (options: SessionOptions) => session(context, options),
    cancelLine: (lineId: string) => cancelLine(context, lineId),
    event: (sessionId: string, eventType: RatingEventType) => event(context, sessionId, eventType),
    requests: (customerId?: string) => requests(context.owner, customerId),
    otherBusiness: () => otherBusiness(context.owner, context.ids),
  };
}

async function branch(context: SchedulingDataContext, options: BranchOptions): Promise<string> {
  const { owner, ids } = context;
  const branchId = ids.newId();
  await owner`INSERT INTO branches SELECT (jsonb_populate_record(NULL::branches,
    to_jsonb(b)||jsonb_build_object('id',${branchId}::text,'name_en',${`Branch ${branchId}`}::text,
      'name_ar',${`فرع ${branchId}`}::text))).* FROM branches b
    WHERE b.company_id=${TENANT.A.company} AND b.id=${TENANT.A.branch}`;
  await setHours(owner, branchId, options.openingHours ?? null, options.timezone ?? null);
  return branchId;
}

async function setHours(
  owner: postgres.Sql,
  branchId: string,
  openingHours: OpeningHoursValue | null,
  timezone: string | null,
): Promise<void> {
  if (openingHours === null) {
    await owner`UPDATE branches SET opening_hours=NULL, timezone=${timezone}
      WHERE company_id=${TENANT.A.company} AND id=${branchId}`;
    return;
  }
  await owner`UPDATE branches SET opening_hours=${owner.json(openingHours as unknown as postgres.JSONValue)}, timezone=${timezone}
    WHERE company_id=${TENANT.A.company} AND id=${branchId}`;
}

let phoneSequence = 0;

async function customer(owner: postgres.Sql, ids: IdGenerator): Promise<string> {
  phoneSequence += 1;
  const customerId = ids.newId();
  const phone = `+9999999${String(phoneSequence).padStart(5, '0')}`;
  await owner`INSERT INTO customers SELECT (jsonb_populate_record(NULL::customers,
    to_jsonb(c)||jsonb_build_object('id',${customerId}::text,'phone',${phone}::text))).* FROM customers c
    WHERE c.company_id=${TENANT.A.company} AND c.id=${ORDER_IDS.customer}`;
  return customerId;
}

async function session(
  context: SchedulingDataContext,
  options: SessionOptions,
): Promise<{ sessionId: string; lineId: string }> {
  const { owner, ids } = context;
  const company = options.company ?? TENANT.A.company;
  const tenant = company === TENANT.A.company ? TENANT.A : TENANT.B;
  const businessId = options.businessId ?? tenant.business;
  const branchId = options.branchId ?? tenant.branch;
  const customerId = options.customerId ?? ORDER_IDS.customer;
  const recordedAt = options.recordedAt ?? options.occurredAt;
  const businessDate = localParts(options.occurredAt, 'Asia/Kuwait').date;
  const sessionId = ids.newId();
  const lineId = ids.newId();
  const { serviceId, employeeId } = await refsOf(owner, company, businessId);
  await owner.begin(async (tx) => {
    await tx`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
      to_jsonb(s)||jsonb_build_object('id',${sessionId}::text,'occurred_at',${options.occurredAt}::timestamptz,
        'recorded_at',${recordedAt}::timestamptz,'business_id',${businessId}::text,'branch_id',${branchId}::text,
        'customer_id',${customerId}::text,'business_date',${businessDate}::date))).* FROM service_sessions s
      WHERE s.company_id=${company} AND s.id=${ORDER_IDS.session}`;
    await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
      to_jsonb(l)||jsonb_build_object('id',${lineId}::text,'session_id',${sessionId}::text,
        'business_id',${businessId}::text,'service_id',${serviceId}::text,'status','ACTIVE'::text))).*
      FROM service_lines l WHERE l.company_id=${company} AND l.id=${ORDER_IDS.line}`;
    await tx`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,not_clocked_in_warning,approved_leave_warning)
      VALUES(${company},${ids.newId()},${businessId},${lineId},${employeeId},1,10000,'Performer 1',false,false)`;
  });
  return { sessionId, lineId };
}

async function refsOf(
  owner: postgres.Sql,
  company: string,
  businessId: string,
): Promise<{ serviceId: string; employeeId: string }> {
  const [service] =
    await owner`SELECT id FROM services WHERE company_id=${company} AND business_id=${businessId} LIMIT 1`;
  const [employee] =
    await owner`SELECT id FROM employees WHERE company_id=${company} AND business_id=${businessId}
    ORDER BY employee_number LIMIT 1`;
  if (service === undefined || employee === undefined) throw new Error('SESSION_REFS_MISSING');
  return { serviceId: service['id'] as string, employeeId: employee['id'] as string };
}

async function cancelLine(context: SchedulingDataContext, lineId: string): Promise<void> {
  const { owner, db, ids } = context;
  const company = TENANT.A.company;
  const [row] =
    await owner`SELECT revision FROM service_lines WHERE company_id=${company} AND id=${lineId}`;
  if (row === undefined) throw new Error('LINE_MISSING');
  await db.withTenant(company, (tx) =>
    cancelServiceLine(tx, {
      companyId: company,
      lineId,
      expectedRevision: Number(row['revision']),
      cancelledBy: USER,
      membershipId: ORDER_IDS.membership,
      cancellationId: ids.newId(),
    }),
  );
}

async function event(
  context: SchedulingDataContext,
  sessionId: string,
  eventType: RatingEventType,
): Promise<ClaimedEvent> {
  const { owner, db, ids } = context;
  const [saved] =
    await owner`SELECT s.*, s.business_date::text AS saved_date FROM service_sessions s
    WHERE s.id=${sessionId}`;
  if (saved === undefined) throw new Error('EVENT_SESSION_MISSING');
  const [line] = await owner`SELECT l.*, p.employee_id, p.share_bps FROM service_lines l
    JOIN line_performers p ON p.company_id = l.company_id AND p.line_id = l.id
    WHERE l.session_id=${sessionId} ORDER BY p.performer_ordinal LIMIT 1`;
  if (line === undefined) throw new Error('EVENT_LINE_MISSING');
  const identity = {
    session_id: sessionId,
    business_id: saved['business_id'],
    branch_id: saved['branch_id'],
    customer_id: saved['customer_id'],
    occurred_at: (saved['occurred_at'] as Date).toISOString(),
    recorded_at: (saved['recorded_at'] as Date).toISOString(),
    business_date: saved['saved_date'],
    late: saved['late'],
    recorded_by: USER,
    recorded_by_membership_id: ORDER_IDS.membership,
  };
  const lineBody = {
    ...identity,
    line_id: line['id'],
    service_id: line['service_id'],
    status: line['status'],
    list_price: '1.000',
    price: '1.000',
    discount: '0.000',
    net: '1.000',
    performers: [{ employee_id: line['employee_id'], share_bps: line['share_bps'] }],
    rule_snapshot: { kind: 'ZERO' },
    counts_snapshot: true,
    package: null,
    revision: line['revision'],
  };
  const payload =
    eventType === 'ServiceLineChanged'
      ? {
          ...lineBody,
          ...(line['status'] === 'CANCELLED'
            ? {
                change: {
                  kind: 'LINE_CANCELLED',
                  changed_at: (saved['recorded_at'] as Date).toISOString(),
                  changed_by: USER,
                  changed_by_membership_id: ORDER_IDS.membership,
                  previous: {
                    revision: Number(line['revision']) - 1,
                    price: '1.000',
                    discount: '0.000',
                    net: '1.000',
                  },
                },
              }
            : {}),
        }
      : {
          ...identity,
          schema_version: 1,
          business_timezone: saved['business_timezone'],
          lines: [lineBody],
        };
  const id = ids.newId();
  const company = saved['company_id'] as string;
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

async function requests(owner: postgres.Sql, customerId?: string) {
  return customerId === undefined
    ? owner`SELECT business_date::text AS day, status, cancel_reason, branch_id, due_at, send_deadline
        FROM rating_requests WHERE company_id=${TENANT.A.company} ORDER BY business_date`
    : owner`SELECT business_date::text AS day, status, cancel_reason, branch_id, due_at, send_deadline
        FROM rating_requests WHERE company_id=${TENANT.A.company} AND customer_id=${customerId}
        ORDER BY business_date`;
}

async function otherBusiness(
  owner: postgres.Sql,
  ids: IdGenerator,
): Promise<{ businessId: string; branchId: string }> {
  const businessId = ids.newId();
  const branchId = ids.newId();
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES(${TENANT.A.company},${businessId},'Second salon','salon')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${TENANT.A.company},${branchId},${businessId},'Second branch')`;
  await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${TENANT.A.company},${ids.newId()},${businessId},'Second service',1.000,'ZERO')`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${TENANT.A.company},${ids.newId()},${businessId},${branchId},'Second performer','second performer','staff','2026-01-01',2)`;
  return { businessId, branchId };
}
