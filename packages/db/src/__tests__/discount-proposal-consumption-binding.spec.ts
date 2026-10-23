import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const { A } = TENANT;
const HASH = 'a'.repeat(64);
// خدمة تانية في نفس النشاط: بند بخدمة تانية ما بيستهلكش موافقتها (D-21، R1).
const SERVICE_2 = '01920000-0000-7000-8000-000000004101';
// نشاط تاني في نفس الشركة: موافقة نشاط تاني ما بتستهلكش بند النشاط الأول (D-21، R1).
const BUSINESS_2 = '01920000-0000-7000-8000-000000004102';
const BRANCH_B2 = '01920000-0000-7000-8000-000000004103';
const SERVICE_B2 = '01920000-0000-7000-8000-000000004104';
// فرع تاني في نفس النشاط: طلب باسمفرع غير فرع الزيارة لازم يترفض (D-21، R3).
const BRANCH_2 = '01920000-0000-7000-8000-000000004105';
// زيارة تانية بنفس النشاط والفرع: بند من زيارة تانية ما بيستهلكش موافقة زيارة (D-21، R2).
const SESSION_2 = '01920000-0000-7000-8000-000000004106';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await seedBindings(owner);
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const as = (company: string, query: ReturnType<typeof sql>) =>
  db.withTenant(company, (tx) => tx.execute(query), { userId: USER });

function pgError(error: unknown): { code?: string; constraint_name?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (candidate.code !== undefined || candidate.constraint_name !== undefined) return candidate;
    current = candidate.cause;
  }
  return {};
}

async function refused(work: Promise<unknown>, code: string, constraint?: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect(pgError(error).code).toBe(code);
  if (constraint !== undefined) expect(pgError(error).constraint_name).toBe(constraint);
}

// نشاط تاني بفرع وخدمة، وفرع تاني في النشاط الأول، وزيارة تانية: حدود الحالات بتاعت D-21.
async function seedBindings(connection: postgres.Sql) {
  await connection`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${A.company},${SERVICE_2},${A.business},'Synthetic service two',1.000,'ZERO')`;
  await connection`INSERT INTO businesses(id,company_id,vertical_type,name_en)
    VALUES(${BUSINESS_2},${A.company},'salon','Synthetic business two')`;
  await connection`INSERT INTO branches(id,company_id,business_id,name_en)
    VALUES(${BRANCH_B2},${A.company},${BUSINESS_2},'Synthetic branch of business two')`;
  await connection`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${A.company},${SERVICE_B2},${BUSINESS_2},'Synthetic service of business two',1.000,'ZERO')`;
  await connection`INSERT INTO branches(id,company_id,business_id,name_en)
    VALUES(${BRANCH_2},${A.company},${A.business},'Synthetic branch of business one')`;
  await connection`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,
    to_jsonb(s) || jsonb_build_object('id', ${SESSION_2}::text))).*
    FROM service_sessions s WHERE s.company_id=${A.company} AND s.id=${ORDER_IDS.session}`;
}

type ProposalInput = {
  id: string;
  business?: string;
  branch?: string;
  service?: string;
  session?: string | null;
};

const proposal = ({
  id,
  business = A.business,
  branch = A.branch,
  service = ORDER_IDS.service,
  session = null,
}: ProposalInput) =>
  sql`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_role,requester_role_is_system,requester_role_name_en,
    customer_first_name,requested_at,status,expires_at)
  VALUES(${A.company},${id},${business},${branch},${ids.newId()},0,'RECORD',${session},clock_timestamp(),
    ${ORDER_IDS.customer},${service},'Synthetic service','{}'::jsonb,${HASH},2000,${USER},${ORDER_IDS.membership},
    'PERSON',1000,'cashier',true,'Cashier','Synthetic',clock_timestamp(),'PENDING',clock_timestamp() + interval '1 day')`;

const approve = (id: string) =>
  sql`UPDATE discount_proposals SET status='APPROVED',decided_by=${USER},decided_by_membership_id=${ORDER_IDS.membership},
    decided_via='REMOTE',decider_role='owner',decider_role_is_system=true,decider_role_name_en='Owner',
    decided_at=clock_timestamp(),approved_limit_source='OWNER',approver_is_performer=false WHERE id=${id}`;

type ConsumeInput = {
  proposalId: string;
  lineId: string;
  session: string;
  service: string;
  ordinal: number;
  lineFirst: boolean;
};

// السطر الجديد بينسخ سطر الطلب بـ Id جديد وزيارة وخدمة وترتيب وموافقة جديدة؛ الفحص المؤجل بيقع عند الـ commit.
const consumeWithNewLine = async ({
  proposalId,
  lineId,
  session,
  service,
  ordinal,
  lineFirst,
}: ConsumeInput) =>
  db.withTenant(
    A.company,
    async (tx) => {
      const insertLine = async () => {
        await tx.execute(sql`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
          to_jsonb(l) || jsonb_build_object('id', ${lineId}::text, 'session_id', ${session}::text,
            'service_id', ${service}::text, 'ordinal', ${ordinal}::int, 'input_index', ${ordinal - 1}::int,
            'discount_proposal_id', ${proposalId}::text))).*
          FROM service_lines l WHERE l.company_id=${A.company} AND l.id=${ORDER_IDS.line}`);
        await tx.execute(sql`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,
          to_jsonb(p) || jsonb_build_object('id', ${ids.newId()}::text, 'line_id', ${lineId}::text))).*
          FROM line_performers p WHERE p.company_id=${A.company} AND p.line_id=${ORDER_IDS.line}`);
      };
      const consumeProposal = () =>
        tx.execute(sql`UPDATE discount_proposals SET status='CONSUMED',consumed_line_id=${lineId},
          consumed_at=clock_timestamp() WHERE id=${proposalId}`);
      if (lineFirst) {
        await insertLine();
        await consumeProposal();
      } else {
        await consumeProposal();
        await insertLine();
      }
    },
    { userId: USER },
  );

const consume = (proposalId: string, changes: { session?: string; ordinal?: number } = {}) =>
  consumeWithNewLine({
    proposalId,
    lineId: ids.newId(),
    session: changes.session ?? ORDER_IDS.session,
    service: ORDER_IDS.service,
    ordinal: changes.ordinal ?? 2,
    lineFirst: false,
  });

const consumption = async (proposalId: string, lineId: string) => ({
  proposal: await as(A.company, sql`SELECT status,consumed_line_id FROM discount_proposals WHERE id=${proposalId}`),
  line: await as(A.company, sql`SELECT discount_proposal_id FROM service_lines WHERE id=${lineId}`),
});

it('refuses a consumption of a proposal from another business', async () => {
  const proposalId = ids.newId();
  await as(A.company, proposal({ id: proposalId, business: BUSINESS_2, branch: BRANCH_B2, service: SERVICE_B2 }));
  await as(A.company, approve(proposalId));
  await refused(consume(proposalId), '23503', 'service_lines_discount_proposal_binding_fk');
});

it('refuses a consumption of a proposal for another service', async () => {
  const proposalId = ids.newId();
  await as(A.company, proposal({ id: proposalId, service: SERVICE_2 }));
  await as(A.company, approve(proposalId));
  await refused(
    consume(proposalId, { ordinal: 3 }),
    '23503',
    'service_lines_discount_proposal_binding_fk',
  );
});

it('refuses a consumption of a proposal bound to another visit', async () => {
  const proposalId = ids.newId();
  await as(A.company, proposal({ id: proposalId, session: ORDER_IDS.session }));
  await as(A.company, approve(proposalId));
  await refused(consume(proposalId, { session: SESSION_2, ordinal: 1 }), '23503', 'dp_consumed_line_session_fk');
});

it('refuses a proposal whose branch is not the branch of its visit', async () => {
  await refused(
    as(A.company, proposal({ id: ids.newId(), branch: BRANCH_2, session: ORDER_IDS.session })),
    '23503',
    'dp_session_branch_fk',
  );
});

it('accepts a consumption in the visit the proposal names', async () => {
  const proposalId = ids.newId();
  const lineId = ids.newId();
  await as(A.company, proposal({ id: proposalId, session: ORDER_IDS.session }));
  await as(A.company, approve(proposalId));
  await consumeWithNewLine({
    proposalId,
    lineId,
    session: ORDER_IDS.session,
    service: ORDER_IDS.service,
    ordinal: 4,
    lineFirst: false,
  });
  expect(await consumption(proposalId, lineId)).toEqual({
    proposal: [{ status: 'CONSUMED', consumed_line_id: lineId }],
    line: [{ discount_proposal_id: proposalId }],
  });
});

it('accepts a consumption in a fresh visit when the proposal names none', async () => {
  const proposalId = ids.newId();
  const lineId = ids.newId();
  await as(A.company, proposal({ id: proposalId }));
  await as(A.company, approve(proposalId));
  await consumeWithNewLine({
    proposalId,
    lineId,
    session: SESSION_2,
    service: ORDER_IDS.service,
    ordinal: 2,
    lineFirst: true,
  });
  expect(await consumption(proposalId, lineId)).toEqual({
    proposal: [{ status: 'CONSUMED', consumed_line_id: lineId }],
    line: [{ discount_proposal_id: proposalId }],
  });
});

it('binds the three constraints: two deferred to the commit and one immediate', async () => {
  const rows = await owner<{
    conname: string;
    convalidated: boolean;
    condeferrable: boolean;
    condeferred: boolean;
    definition: string;
  }[]>`SELECT conname,convalidated,condeferrable,condeferred,pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname IN ('service_lines_discount_proposal_binding_fk','dp_consumed_line_session_fk','dp_session_branch_fk')
    ORDER BY conname`;
  expect(rows).toEqual([
    {
      conname: 'dp_consumed_line_session_fk',
      convalidated: true,
      condeferrable: true,
      condeferred: true,
      definition:
        'FOREIGN KEY (company_id, consumed_line_id, session_id) REFERENCES service_lines(company_id, id, session_id) DEFERRABLE INITIALLY DEFERRED',
    },
    {
      conname: 'dp_session_branch_fk',
      convalidated: true,
      condeferrable: false,
      condeferred: false,
      definition:
        'FOREIGN KEY (company_id, branch_id, session_id) REFERENCES service_sessions(company_id, branch_id, id)',
    },
    {
      conname: 'service_lines_discount_proposal_binding_fk',
      convalidated: true,
      condeferrable: true,
      condeferred: true,
      definition:
        'FOREIGN KEY (company_id, discount_proposal_id, id, business_id, service_id) REFERENCES discount_proposals(company_id, id, consumed_line_id, business_id, service_id) DEFERRABLE INITIALLY DEFERRED',
    },
  ]);
});
