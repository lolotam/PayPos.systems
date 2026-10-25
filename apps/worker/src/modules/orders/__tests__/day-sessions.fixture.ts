import postgres from 'postgres';
import { createDatabase, type Database, type IdGenerator } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS, seedOrders } from '../../../../../../packages/db/test/orders-fixture.ts';
import { cancelServiceLine } from '../../../../../../packages/db/test/service-line-cancellation.ts';
import { PROVISIONAL_PLAN_ID } from '../../../../../../packages/db/src/seed.ts';

/** overrides نسخة الزيارة: كل حقل اختياري، واللي ما يتكتبش بيبقى زي البذرة. */
export interface SessionOptions {
  id?: string;
  occurredAt?: Date;
  recordedAt?: Date;
  branchId?: string;
  customerId?: string;
  businessId?: string;
  businessDate?: string;
  company?: string;
  performers?: PerformerInput[];
}

/** منفذ واحد في بند: حصته بال-basis points، ومجموع الحصة لازم يبقى عشرة آلاف. */
export interface PerformerInput {
  employeeId: string;
  shareBps: number;
}

/** عقدة خطة EXPLAIN: بنحتاج نوعها واسم الفهرس بس. */
export interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

interface SeededRow {
  id: string;
  businessId: string;
  branchId: string;
  customerId: string;
  occurredAt: Date;
  recordedAt: Date;
  businessDate: string;
}

let phoneSequence = 0;
let employeeSequence = 1;

export async function daySessionsFixture() {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  await seedOrders(owner);
  const ids = systemUuidV7();
  const db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 6 });
  return {
    testDb,
    owner,
    db,
    ids,
    tenant: TENANT.A,
    seeded: await seededRow(owner, TENANT.A.company),
    session: (options: SessionOptions = {}) => createSession(owner, ids, options),
    addLine: (
      sessionId: string,
      status: 'ACTIVE' | 'CANCELLED' = 'ACTIVE',
      performers?: PerformerInput[],
    ) => addLine(db, owner, ids, sessionId, status, performers),
    addEmployee: () =>
      addEmployee(owner, ids, TENANT.A.company, TENANT.A.business, TENANT.A.branch),
    cancelLine: (lineId: string) => cancelLine(db, owner, ids, lineId),
    addCustomer: () => addCustomer(owner, ids),
    addBusiness: () => addBusiness(owner, ids, TENANT.A.company),
    addCompany: () => addCompany(owner, ids),
    planNodes,
    close: async () => {
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}
export type DaySessionsFixture = Awaited<ReturnType<typeof daySessionsFixture>>;

async function seededRow(owner: postgres.Sql, company: string): Promise<SeededRow> {
  const [row] =
    await owner`SELECT id, business_id, branch_id, customer_id, occurred_at, recorded_at,
      business_date::text AS business_date
    FROM service_sessions WHERE company_id=${company} AND id=${ORDER_IDS.session}`;
  if (row === undefined) throw new Error('SEEDED_SESSION_MISSING');
  return {
    id: row['id'] as string,
    businessId: row['business_id'] as string,
    branchId: row['branch_id'] as string,
    customerId: row['customer_id'] as string,
    occurredAt: row['occurred_at'] as Date,
    recordedAt: row['recorded_at'] as Date,
    businessDate: row['business_date'] as string,
  };
}

function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

async function createSession(
  owner: postgres.Sql,
  ids: IdGenerator,
  options: SessionOptions,
): Promise<{ sessionId: string; lineId: string }> {
  const company = options.company ?? TENANT.A.company;
  const seeded = await seededRow(owner, company);
  const sessionId = options.id ?? ids.newId();
  const lineId = ids.newId();
  const occurredAt = options.occurredAt ?? seeded.occurredAt;
  const recordedAt = options.recordedAt ?? seeded.recordedAt;
  const businessId = options.businessId ?? seeded.businessId;
  const branchId = options.branchId ?? (await branchOf(owner, company, businessId));
  const customerId = options.customerId ?? seeded.customerId;
  const businessDate = options.businessDate ?? utcDate(occurredAt);
  const { serviceId, employeeId } = await refsOf(owner, company, businessId);
  const performers = options.performers ?? [{ employeeId, shareBps: 10000 }];
  await owner.begin(async (tx) => {
    await tx`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
      to_jsonb(s)||jsonb_build_object('id',${sessionId}::text,'occurred_at',${occurredAt}::timestamptz,
        'recorded_at',${recordedAt}::timestamptz,'business_id',${businessId}::text,'branch_id',${branchId}::text,
        'customer_id',${customerId}::text,'business_date',${businessDate}::date))).* FROM service_sessions s
      WHERE s.company_id=${company} AND s.id=${ORDER_IDS.session}`;
    await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
      to_jsonb(l)||jsonb_build_object('id',${lineId}::text,'session_id',${sessionId}::text,
        'business_id',${businessId}::text,'service_id',${serviceId}::text,'status','ACTIVE'::text))).*
      FROM service_lines l WHERE l.company_id=${company} AND l.id=${ORDER_IDS.line}`;
    await insertPerformers(tx, ids, company, businessId, lineId, performers);
  });
  return { sessionId, lineId };
}

async function insertPerformers(
  tx: postgres.TransactionSql,
  ids: IdGenerator,
  company: string,
  businessId: string,
  lineId: string,
  performers: readonly PerformerInput[],
): Promise<void> {
  for (const [index, performer] of performers.entries()) {
    await tx`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,not_clocked_in_warning,approved_leave_warning)
      VALUES(${company},${ids.newId()},${businessId},${lineId},${performer.employeeId},${index + 1},${performer.shareBps},${`Performer ${index + 1}`},false,false)`;
  }
}

async function branchOf(owner: postgres.Sql, company: string, businessId: string): Promise<string> {
  const [row] =
    await owner`SELECT id FROM branches WHERE company_id=${company} AND business_id=${businessId} LIMIT 1`;
  if (row === undefined) throw new Error('SESSION_BRANCH_MISSING');
  return row['id'] as string;
}

async function refsOf(
  owner: postgres.Sql,
  company: string,
  businessId: string,
): Promise<{ serviceId: string; employeeId: string }> {
  const [service] =
    await owner`SELECT id FROM services WHERE company_id=${company} AND business_id=${businessId} LIMIT 1`;
  // الرقم الوظيفي هو المفتاح: أول موظف في النشاط هو موظف البذرة، فالبذرة ثابتة بعد إضافة موظف تاني.
  const [employee] =
    await owner`SELECT id FROM employees WHERE company_id=${company} AND business_id=${businessId}
    ORDER BY employee_number LIMIT 1`;
  if (service === undefined || employee === undefined) throw new Error('SESSION_REFS_MISSING');
  return { serviceId: service['id'] as string, employeeId: employee['id'] as string };
}

async function addLine(
  db: Database,
  owner: postgres.Sql,
  ids: IdGenerator,
  sessionId: string,
  status: 'ACTIVE' | 'CANCELLED',
  performers: PerformerInput[] | undefined,
): Promise<string> {
  const [session] =
    await owner`SELECT company_id, business_id FROM service_sessions WHERE id=${sessionId}`;
  if (session === undefined) throw new Error('SESSION_MISSING');
  const company = session['company_id'] as string;
  const businessId = session['business_id'] as string;
  const { serviceId, employeeId } = await refsOf(owner, company, businessId);
  const [next] = await owner`SELECT coalesce(max(ordinal),0)+1 AS next FROM service_lines
    WHERE company_id=${company} AND session_id=${sessionId}`;
  const ordinal = Number(next?.['next'] ?? 1);
  const lineId = ids.newId();
  const performersOfLine = performers ?? [{ employeeId, shareBps: 10000 }];
  await owner.begin(async (tx) => {
    await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
      to_jsonb(l)||jsonb_build_object('id',${lineId}::text,'session_id',${sessionId}::text,
        'business_id',${businessId}::text,'service_id',${serviceId}::text,'status','ACTIVE'::text,
        'ordinal',${ordinal}::int,'input_index',${ordinal - 1}::int))).*
      FROM service_lines l WHERE l.company_id=${company} AND l.id=${ORDER_IDS.line}`;
    await insertPerformers(tx, ids, company, businessId, lineId, performersOfLine);
  });
  // السطر بيتعمل نشط الأول، والإلغاء بيمشي على مساره الرسمي عشان صف الإلغاء يتكتب معاه.
  if (status === 'CANCELLED') await cancelLine(db, owner, ids, lineId);
  return lineId;
}

async function addEmployee(
  owner: postgres.Sql,
  ids: IdGenerator,
  company: string,
  businessId: string,
  branchId: string,
): Promise<string> {
  employeeSequence += 1;
  const employeeId = ids.newId();
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${company},${employeeId},${businessId},${branchId},'Extra performer','extra performer','staff','2026-01-01',${employeeSequence})`;
  return employeeId;
}

async function cancelLine(
  db: Database,
  owner: postgres.Sql,
  ids: IdGenerator,
  lineId: string,
): Promise<void> {
  const [row] = await owner`SELECT revision FROM service_lines
    WHERE company_id=${TENANT.A.company} AND id=${lineId}`;
  if (row === undefined) throw new Error('LINE_MISSING');
  await db.withTenant(TENANT.A.company, (tx) =>
    cancelServiceLine(tx, {
      companyId: TENANT.A.company,
      lineId,
      expectedRevision: Number(row['revision']),
      cancelledBy: USER,
      membershipId: ORDER_IDS.membership,
      cancellationId: ids.newId(),
    }),
  );
}

async function addCustomer(owner: postgres.Sql, ids: IdGenerator): Promise<string> {
  phoneSequence += 1;
  const customerId = ids.newId();
  const phone = `+9999999${String(phoneSequence).padStart(5, '0')}`;
  await owner`INSERT INTO customers SELECT (jsonb_populate_record(NULL::customers,
    to_jsonb(c)||jsonb_build_object('id',${customerId}::text,'phone',${phone}::text))).* FROM customers c
    WHERE c.company_id=${TENANT.A.company} AND c.id=${ORDER_IDS.customer}`;
  return customerId;
}

async function addBusiness(
  owner: postgres.Sql,
  ids: IdGenerator,
  company: string,
): Promise<{ businessId: string; branchId: string }> {
  const businessId = ids.newId();
  const branchId = ids.newId();
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${company},${businessId},'Second salon','salon')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${company},${branchId},${businessId},'Second branch')`;
  await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${company},${ids.newId()},${businessId},'Second service',1.000,'ZERO')`;
  employeeSequence += 1;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${company},${ids.newId()},${businessId},${branchId},'Second performer','second performer','staff','2026-01-01',${employeeSequence})`;
  return { businessId, branchId };
}

async function addCompany(owner: postgres.Sql, ids: IdGenerator): Promise<{ companyId: string }> {
  const companyId = ids.newId();
  const businessId = ids.newId();
  await owner`INSERT INTO companies(id,name_en,owner_user_id,plan_id) VALUES(${companyId},'Company C',${USER},${PROVISIONAL_PLAN_ID})`;
  await owner`INSERT INTO businesses(id,company_id,vertical_type,name_en) VALUES(${businessId},${companyId},'salon','Business C')`;
  await owner`INSERT INTO branches(id,company_id,business_id,name_en) VALUES(${ids.newId()},${companyId},${businessId},'Branch C')`;
  return { companyId };
}

export function planNodes(rows: readonly Record<string, unknown>[]): PlanNode[] {
  const first = rows[0];
  if (first === undefined) throw new Error('EXPLAIN_PLAN_MISSING');
  const raw = Object.values(first)[0];
  // عمود EXPLAIN بيجي نص، فنحلله قبل ما نبني شجرة الخطة.
  const value: unknown = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(value)) throw new Error('EXPLAIN_PLAN_MISSING');
  const root = value[0] as { Plan?: PlanNode } | undefined;
  if (root === undefined || root.Plan === undefined) throw new Error('EXPLAIN_PLAN_MISSING');
  const collected: PlanNode[] = [];
  const visit = (node: PlanNode): void => {
    collected.push(node);
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(root.Plan);
  return collected;
}
