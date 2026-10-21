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
// سطر ثانٍ في نفس الشركة: التعديل بتاعه لازم يترفض على بند تاني حتى لو الشركة واحدة.
const OTHER_LINE = '01920000-0000-7000-8000-000000004008';
const OWN_EDIT = '01920000-0000-7000-8000-000000004009';
const OTHER_EDIT = '01920000-0000-7000-8000-00000000400a';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await seedOtherLine(owner);
  await seedEdits(owner);
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

// سطر ثانٍ بنفس الشركة مع منفّذ واحد، عشان فحص اتساق المنفّذين يمر زي ما مر في السطر المزروع.
async function seedOtherLine(connection: postgres.Sql) {
  await connection.begin(async (tx) => {
    await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,
      to_jsonb(l) || jsonb_build_object('id', ${OTHER_LINE}::text, 'ordinal', 2, 'input_index', 1))).*
      FROM service_lines l WHERE l.company_id=${A.company} AND l.id=${ORDER_IDS.line}`;
    await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,
      to_jsonb(p) || jsonb_build_object('id', ${ids.newId()}::text, 'line_id', ${OTHER_LINE}::text))).*
      FROM line_performers p WHERE p.company_id=${A.company} AND p.line_id=${ORDER_IDS.line}`;
  });
}

// تعديلان: واحد على بند الطلب وواحد على السطر التاني؛ كل الأعمدة الإلزامية مكتوبة والشروط محفوظة.
async function seedEdits(connection: postgres.Sql) {
  await connection`INSERT INTO service_line_edits(company_id,id,business_id,line_id,revision,previous_revision,previous_price,
    previous_discount,previous_net,new_price,new_discount,new_net,previous_effective_discount_bps,previous_limit_source,
    new_effective_discount_bps,new_limit_source,reason,changed_at,changed_by,changed_by_membership_id,editor_name_en,editor_role,
    editor_role_is_system,editor_role_name_en)
  VALUES(${A.company},${OWN_EDIT},${A.business},${ORDER_IDS.line},2,1,25.000,5.000,20.000,25.000,5.000,20.000,2000,'OWNER',2000,
    'OWNER','Synthetic edit',clock_timestamp(),${USER},${ORDER_IDS.membership},'Synthetic editor','owner',true,'Owner')`;
  await connection`INSERT INTO service_line_edits(company_id,id,business_id,line_id,revision,previous_revision,previous_price,
    previous_discount,previous_net,new_price,new_discount,new_net,previous_effective_discount_bps,previous_limit_source,
    new_effective_discount_bps,new_limit_source,reason,changed_at,changed_by,changed_by_membership_id,editor_name_en,editor_role,
    editor_role_is_system,editor_role_name_en)
  VALUES(${A.company},${OTHER_EDIT},${A.business},${OTHER_LINE},2,1,25.000,5.000,20.000,25.000,5.000,20.000,2000,'OWNER',2000,
    'OWNER','Synthetic edit',clock_timestamp(),${USER},${ORDER_IDS.membership},'Synthetic editor','owner',true,'Owner')`;
}

const editProposal = (id: string) =>
  sql`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,line_id,base_revision,
    base_price,base_discount,base_net,session_id,occurred_at,customer_id,service_id,service_name_en,terms,terms_hash,effective_bps,
    requested_by,requested_by_membership_id,requester_limit_source,requester_limit_bps,requester_role,requester_role_is_system,
    requester_role_name_en,customer_first_name,requested_at,status,expires_at)
  VALUES(${A.company},${id},${A.business},${A.branch},${ids.newId()},0,'EDIT',${ORDER_IDS.line},2,
    25.000,5.000,20.000,${ORDER_IDS.session},clock_timestamp(),${ORDER_IDS.customer},${ORDER_IDS.service},'Synthetic service',
    '{}'::jsonb,${HASH},2000,${USER},${ORDER_IDS.membership},'PERSON',1000,'cashier',true,'Cashier','Synthetic',
    clock_timestamp(),'PENDING',clock_timestamp() + interval '1 day')`;

const approve = (id: string) =>
  sql`UPDATE discount_proposals SET status='APPROVED',decided_by=${USER},decided_by_membership_id=${ORDER_IDS.membership},
    decided_via='REMOTE',decider_role='owner',decider_role_is_system=true,decider_role_name_en='Owner',
    decided_at=clock_timestamp(),approved_limit_source='OWNER',approver_is_performer=false WHERE id=${id}`;

const consume = (id: string, editId: string) =>
  sql`UPDATE discount_proposals SET status='CONSUMED',consumed_edit_id=${editId},consumed_at=clock_timestamp() WHERE id=${id}`;

it('refuses a consumption that names an edit that does not exist', async () => {
  const id = ids.newId();
  await as(A.company, editProposal(id));
  await as(A.company, approve(id));
  await refused(as(A.company, consume(id, ids.newId())), '23503', 'dp_consumed_edit_fk');
});

it('refuses a consumption that names the edit of another line', async () => {
  const id = ids.newId();
  await as(A.company, editProposal(id));
  await as(A.company, approve(id));
  await refused(as(A.company, consume(id, OTHER_EDIT)), '23503', 'dp_consumed_edit_fk');
});

it('accepts a consumption that names an edit of its own line', async () => {
  const id = ids.newId();
  await as(A.company, editProposal(id));
  await as(A.company, approve(id));
  await as(A.company, consume(id, OWN_EDIT));
  const rows = await as(
    A.company,
    sql`SELECT status,consumed_edit_id FROM discount_proposals WHERE id=${id}`,
  );
  expect(rows).toEqual([{ status: 'CONSUMED', consumed_edit_id: OWN_EDIT }]);
});
