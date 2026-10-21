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
const { A, B } = TENANT;
const HASH = 'a'.repeat(64);

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
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
    const candidate = current as Error & { code?: string; constraint_name?: string; cause?: unknown };
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

const proposal = (company: string, business: string, branch: string, id: string, status = 'PENDING') =>
  sql`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_role,requester_role_is_system,requester_role_name_en,
    customer_first_name,requested_at,status,expires_at)
  VALUES(${company},${id},${business},${branch},${ids.newId()},0,'RECORD',${ORDER_IDS.session},clock_timestamp(),
    ${ORDER_IDS.customer},${ORDER_IDS.service},'Synthetic service','{}'::jsonb,${HASH},2000,${USER},${ORDER_IDS.membership},
    'PERSON',1000,'cashier',true,'Cashier','Synthetic',clock_timestamp(),${status},clock_timestamp() + interval '1 day')`;

const performer = (company: string, business: string, proposalId: string) =>
  sql`INSERT INTO discount_proposal_performers(company_id,id,business_id,proposal_id,employee_id,linked_user_id,first_name_en)
  VALUES(${company},${ids.newId()},${business},${proposalId},${ORDER_IDS.employee},${USER},'Synthetic')`;

const approveRemote = (id: string, extra = sql``) =>
  sql`UPDATE discount_proposals SET status='APPROVED',decided_by=${USER},decided_by_membership_id=${ORDER_IDS.membership},
    decided_via='REMOTE',decider_role='owner',decider_role_is_system=true,decider_role_name_en='Owner',
    decided_at=clock_timestamp(),approved_limit_source='OWNER',approver_is_performer=false ${extra} WHERE id=${id}`;

it.each([
  ['discount_proposals', ['INSERT', 'SELECT', 'UPDATE']],
  ['discount_proposal_performers', ['INSERT', 'SELECT']],
])('%s forces row-level security with explicit tenant policies', async (table, commands) => {
  const [row] = await owner`SELECT relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class
    WHERE oid=${table}::regclass`;
  expect(row).toEqual({ rls: true, forced: true });
  const policies = await owner`SELECT cmd, qual, with_check FROM pg_policies WHERE tablename=${table} ORDER BY cmd`;
  expect(policies.map((policy) => policy['cmd'])).toEqual(commands);
  for (const policy of policies) {
    for (const clause of [policy['qual'], policy['with_check']].filter((c) => c !== null)) {
      expect(clause).toBe('(company_id = app_company_id())');
    }
  }
});

it('isolates proposals and performers and refuses cross-company writes', async () => {
  const id = ids.newId();
  await as(A.company, proposal(A.company, A.business, A.branch, id));
  await as(A.company, performer(A.company, A.business, id));
  expect(await as(B.company, sql`SELECT id FROM discount_proposals WHERE company_id=${A.company}`)).toEqual([]);
  expect(
    await as(B.company, sql`SELECT id FROM discount_proposal_performers WHERE company_id=${A.company}`),
  ).toEqual([]);
  expect(await as(B.company, sql`UPDATE discount_proposals SET status='REJECTED' WHERE id=${id} RETURNING id`)).toEqual([]);
  await refused(as(A.company, proposal(B.company, B.business, B.branch, ids.newId())), '42501');
  await refused(as(A.company, performer(B.company, B.business, id)), '42501');
});

it('allows only PENDING to APPROVED or REJECTED and APPROVED to CONSUMED', async () => {
  const id = ids.newId();
  await refused(as(A.company, proposal(A.company, A.business, A.branch, ids.newId(), 'APPROVED')), '23514');
  await as(A.company, proposal(A.company, A.business, A.branch, id));
  await refused(as(A.company, sql`UPDATE discount_proposals SET status='CONSUMED' WHERE id=${id}`), '23514');
  await refused(as(A.company, approveRemote(id, sql`, decided_device_id=${ids.newId()}`)), '23514', 'dp_decided_via_ck');
  await as(A.company, approveRemote(id));
  await refused(as(A.company, sql`UPDATE discount_proposals SET status='PENDING' WHERE id=${id}`), '23514');
  await refused(
    as(A.company, sql`UPDATE discount_proposals SET status='CONSUMED',consumed_line_id=${ORDER_IDS.line},
      consumed_at=clock_timestamp(),approved_limit_source='PERSON',approved_limit_bps=3000 WHERE id=${id}`),
    '23514',
    'discount_proposals_transition_guard',
  );
});

it('freezes the terms and the D-18 snapshots, even for the table owner', async () => {
  const id = ids.newId();
  await as(A.company, proposal(A.company, A.business, A.branch, id));
  await refused(as(A.company, sql`UPDATE discount_proposals SET terms_hash=${'b'.repeat(64)} WHERE id=${id}`), '42501');
  await refused(
    owner`UPDATE discount_proposals SET customer_first_name='Other', status='REJECTED', decided_by=${USER},
      decided_by_membership_id=${ORDER_IDS.membership}, decided_via='REMOTE', decider_role='owner',
      decider_role_is_system=true, decider_role_name_en='Owner', decided_at=clock_timestamp() WHERE id=${id}`,
    '23514',
    'discount_proposals_transition_guard',
  );
});

it('refuses a consumption whose line does not name the proposal back, at commit', async () => {
  const id = ids.newId();
  await as(A.company, proposal(A.company, A.business, A.branch, id));
  await as(A.company, approveRemote(id));
  await refused(
    as(A.company, sql`UPDATE discount_proposals SET status='CONSUMED',consumed_line_id=${ORDER_IDS.line},
      consumed_at=clock_timestamp() WHERE id=${id}`),
    '23503',
    'dp_consumed_line_fk',
  );
  await owner.begin(async (tx) => {
    await tx`UPDATE discount_proposals SET status='CONSUMED',consumed_line_id=${ORDER_IDS.line},consumed_at=clock_timestamp()
      WHERE company_id=${A.company} AND id=${id}`;
    await tx`UPDATE service_lines SET discount_proposal_id=${id} WHERE company_id=${A.company} AND id=${ORDER_IDS.line}`;
  });
  const [line] = await owner`SELECT discount_proposal_id FROM service_lines WHERE company_id=${A.company} AND id=${ORDER_IDS.line}`;
  expect(line?.['discount_proposal_id']).toBe(id);
});

it('refuses a deciding device of another branch', async () => {
  const id = ids.newId();
  await as(A.company, proposal(A.company, A.business, A.branch, id));
  await refused(
    as(A.company, sql`UPDATE discount_proposals SET status='REJECTED',decided_by=${USER},decided_by_membership_id=${ORDER_IDS.membership},
      decided_via='PIN',decided_device_id=${ids.newId()},decider_role='owner',decider_role_is_system=true,
      decider_role_name_en='Owner',decided_at=clock_timestamp() WHERE id=${id}`),
    '23503',
    'dp_decided_device_fk',
  );
});
